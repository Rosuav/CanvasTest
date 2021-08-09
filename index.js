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
function build_element_path(has_parent, children) {
	const path = new Path2D;
	path.moveTo(0, 0);
	path.lineTo(200, 0);
	path.lineTo(200, 30);
	let y = 30;
	path.connections = [];
	for (let i = 0; i < children.length; ++i) {
		if (i) {
			//For second and subsequent children, add a separator bar and a label.
			path.lineTo(200, y);
			path.lineTo(200, y += 20);
		}
		path.connections.push({x: 10, y, name: "unknown"})
		path.lineTo(10, y);
		path.lineTo(10, y + 5);
		path.arc(10, y + 15, 10, Math.PI * 3 / 2, Math.PI / 2, false);
		path.lineTo(10, y + 40);
		y += 40;
	}
	path.lineTo(0, y);
	path.lineTo(0, 30);
	if (has_parent) { //Object has a connection point on its left edge
		path.lineTo(0, 25);
		path.arc(0, 15, 10, Math.PI / 2, Math.PI * 3 / 2, true);
	}
	path.closePath();
	return path;
}

const objects = {
	anchor: build_element_path(0, [[]]),
	text: build_element_path(1, []),
	builtin: build_element_path(1, [[]]),
	conditional: build_element_path(1, [[], []]),
};
const connections = {
	anchor: [{x: 10, y: 30, name: "message"}],
};

const elements = [
	{type: "anchor", x: 10, y: 10, fixed: true, color: "#ffff00", label: "When !foo is typed..."},
	{type: "text", x: 220, y: 30, color: "#77eeee", label: "Hello, world!"},
	{type: "builtin", x: 250, y: 100, color: "#ee77ee", label: "Get channel uptime"},
	{type: "conditional", x: 10, y: 150, color: "#7777ee", label: "If..."},
];

function draw_at(ctx, el) {
	ctx.save();
	ctx.translate(el.x|0, el.y|0);
	ctx.fillStyle = el.color;
	ctx.fill(objects[el.type]);
	ctx.fillStyle = "black";
	ctx.font = "12px sans";
	ctx.fillText(el.label || "", 20, 20, 175);
	ctx.stroke(objects[el.type]);
	ctx.restore();
}

function repaint() {
	ctx.clearRect(0, 0, canvas.width, canvas.height);
	elements.forEach(el => draw_at(ctx, el));
}
repaint();

let dragging = null, dragbasex = 50, dragbasey = 10;
canvas.addEventListener("pointerdown", e => {
	if (e.button) return; //Only left clicks
	e.target.setPointerCapture(e.pointerId);
	dragging = null;
	elements.forEach(el => {
		if (el.fixed) return;
		const x = e.offsetX - el.x, y = e.offsetY - el.y;
		if (ctx.isPointInPath(objects[el.type], x, y)) {
			dragging = el; dragbasex = x; dragbasey = y;
		}
	});
});

function snap_to_elements(xpos, ypos) {
	//TODO: Optimize this?? We should be able to check against only those which are close by.
	for (let el of elements) {
		for (let conn of objects[el.type].connections || []) {
			const snapx = el.x + conn.x, snapy = el.y + conn.y;
			if (((snapx - xpos) ** 2 + (snapy - ypos) ** 2) <= SNAP_RANGE)
				return [snapx, snapy]; //First match locks it in. No other snapping done.
		}
	}
	return [xpos, ypos];
}

canvas.addEventListener("pointermove", e => {
	if (!dragging) return;
	[dragging.x, dragging.y] = snap_to_elements(e.offsetX - dragbasex, e.offsetY - dragbasey);
	repaint();
});

canvas.addEventListener("pointerup", e => {
	dragging = null;
	e.target.releasePointerCapture(e.pointerId);
});
