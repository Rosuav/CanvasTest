/* TODO

* Template objects. Drag from them to spawn new elements, but they won't leave their places.
  - If you drop back onto a template, despawn the dragged element
* Extending connection bars. If a parent has children attached, lengthen the bar to allow one more.
* Parents track their attached children
* Children move with parent. A draggable parent drags its children (by the ear, probably).
* Multiple child connection points
* Export to JSON
* Edit attributes on double-click
* Drag paint to element to set attributes (eg a "voice" paint)
* Element colour (and opacity)
* Create paths as required, and cache them. Identify required paths by their parent and child counts.
* Element types define the number of child *groups* but not the number of children.

Eventually this will go into StilleBot as an alternative command editor. Saving will be via the exact same
JSON format that the current editor uses, making them completely compatible. Note that information that
cannot be represented in JSON (eg exact pixel positions, and unanchored elements) will be lost on save/load.

There will always be a single anchor, whose text (and possibly colour) will be determined by what we are
editing (command, trigger, special, etc). Some anchors will offer information the way builtins do, others
will be configurable (eg triggers).
*/

//A type inherently has 0, 1, or 2 (or maybe more) connection sections (children, defined by attribute name).
//A path has 1 basis location and 1+ connection points for each section
//An object has an array of children for each section
//The basis location plus the offset times the child's index equals the connection point location
//The connection point should be ignored if the corresponding child is not "".

const SNAP_RANGE = 100; //Distance-squared to permit snapping (25 = 5px radius)
const canvas = document.querySelector("canvas");
const ctx = canvas.getContext('2d');

const types = {
	anchor: {fixed: true, children: ["message"]},
	text: { },
	builtin: {children: ["message"]},
	conditional: {children: ["message", "otherwise"]},
};

const path_cache = { }; //TODO: Clean this out periodically
function element_path(element) {
	if (element === "") return {totheight: 30}; //Simplify height calculation
	//Calculate a cache key for the element. This should be affected by anything that affects
	//the path/clickable area, but not things that merely affect display (colour, text, etc).
	let cache_key = element.type;
	for (let attr of types[element.type].children || []) {
		const childset = element[attr] || [""];
		cache_key += "[" + childset.map(c => element_path(c).totheight).join() + "]";
	}
	if (path_cache[cache_key]) return path_cache[cache_key];
	console.log("Generating path for", cache_key);
	const type = types[element.type];
	const path = new Path2D;
	path.moveTo(0, 0);
	path.lineTo(200, 0);
	path.lineTo(200, 30);
	let y = 30;
	const connections = [];
	if (type.children) for (let i = 0; i < type.children.length; ++i) {
		if (i) {
			//For second and subsequent children, add a separator bar and room for a label.
			path.lineTo(200, y);
			path.lineTo(200, y += 20);
		}
		const childset = element[type.children[i]];
		if (childset) for (let c = 0; c < childset.length; ++c) {
			if (childset[c] === "") connections.push({x: 10, y, name: type.children[i], index: c});
			path.lineTo(10, y);
			path.lineTo(10, y + 5);
			path.arc(10, y + 15, 10, Math.PI * 3 / 2, Math.PI / 2, false);
			path.lineTo(10, y += element_path(childset[c]).totheight);
		}
		path.lineTo(10, y += 10); //Leave a bit of a gap under the last child slot to indicate room for more
	}
	path.lineTo(0, y);
	path.lineTo(0, 30);
	if (!type.fixed) { //Object has a connection point on its left edge
		path.lineTo(0, 25);
		path.arc(0, 15, 10, Math.PI / 2, Math.PI * 3 / 2, true);
	}
	path.closePath();
	console.log("Connections:", connections);
	return path_cache[cache_key] = {path, connections, totheight: y};
}

const elements = [
	{type: "anchor", x: 10, y: 10, color: "#ffff00", label: "When !foo is typed...", message: [""]},
	{type: "text", x: 220, y: 30, color: "#77eeee", label: "Hello, world!"},
	{type: "builtin", x: 250, y: 100, color: "#ee77ee", label: "Get channel uptime", message: [""]},
	{type: "conditional", x: 10, y: 150, color: "#7777ee", label: "If...", message: [""], otherwise: [""]},
];

function draw_at(ctx, el) {
	const path = element_path(el);
	ctx.save();
	ctx.translate(el.x|0, el.y|0);
	ctx.fillStyle = el.color;
	ctx.fill(path.path);
	ctx.fillStyle = "black";
	ctx.font = "12px sans";
	ctx.fillText(el.label || "", 20, 20, 175);
	ctx.stroke(path.path);
	ctx.restore();
}

function repaint() {
	ctx.clearRect(0, 0, canvas.width, canvas.height);
	elements.forEach(el => draw_at(ctx, el));
}
repaint();

function remove_child(childset, idx) {
	console.log("Remove", idx, "from", childset);
	while (++idx < childset.length - 1) {
		const cur = childset[idx - 1] = childset[idx];
		if (cur === "") continue;
		//assert cur.parent is array
		//assert cur.parent[0][cur.parent[1]] is childset
		cur.parent[2]--;
	}
	childset.pop();
}

let dragging = null, dragbasex = 50, dragbasey = 10;
canvas.addEventListener("pointerdown", e => {
	if (e.button) return; //Only left clicks
	e.target.setPointerCapture(e.pointerId);
	dragging = null;
	for (let el of elements) {
		if (types[el.type].fixed) continue;
		const x = e.offsetX - el.x, y = e.offsetY - el.y;
		const path = element_path(el);
		if (ctx.isPointInPath(path.path, x, y)) {
			dragging = el; dragbasex = x; dragbasey = y;
			if (el.parent) {
				const childset = el.parent[0][el.parent[1]], idx = el.parent[2];
				childset[idx] = "";
				//If this makes a double empty, remove one of them.
				//This may entail moving other elements up a slot, changing their parent pointers.
				//(OOB array indexing will never return an empty string)
				//Note that it is possible to have three in a row, in which case we'll remove twice.
				while (childset[idx - 1] === "" && childset[idx] === "") remove_child(childset, idx);
				if (childset[idx] === "" && childset[idx + 1] === "") remove_child(childset, idx);
				el.parent = null;
			}
			return; //Drag the first available and no other.
		}
	}
});

function snap_to_elements(xpos, ypos) {
	//TODO: Optimize this?? We should be able to check against only those which are close by.
	for (let el of elements) {
		const path = element_path(el);
		for (let conn of path.connections || []) {
			const snapx = el.x + conn.x, snapy = el.y + conn.y;
			if (((snapx - xpos) ** 2 + (snapy - ypos) ** 2) <= SNAP_RANGE)
				return [snapx, snapy, el, conn]; //First match locks it in. No other snapping done.
		}
	}
	return [xpos, ypos, null, null];
}

canvas.addEventListener("pointermove", e => {
	if (!dragging) return;
	[dragging.x, dragging.y] = snap_to_elements(e.offsetX - dragbasex, e.offsetY - dragbasey);
	repaint();
});

canvas.addEventListener("pointerup", e => {
	//Recalculate connections only on pointer-up. (Or would it be better to do it on pointer-move?)
	let parent, conn;
	[dragging.x, dragging.y, parent, conn] = snap_to_elements(e.offsetX - dragbasex, e.offsetY - dragbasey);
	console.log("Snap to", parent, conn);
	if (parent) {
		const childset = parent[conn.name];
		childset[conn.index] = dragging;
		dragging.parent = [parent, conn.name, conn.index];
		if (conn.index === childset.length - 1) childset.push(""); //Ensure there's always an empty slot at the end
	}
	dragging = null;
	e.target.releasePointerCapture(e.pointerId);
	repaint();
});
