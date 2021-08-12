/* TODO

* Export to JSON
* Drag paint to element to set attributes (eg a "voice" paint)
* Have a small button on the element or something that shows the properties? Can be done with double click,
  but maybe it'd be better to have a more visually obvious indicator?
* Template trays. All templates are organized into trays, of which one (and only one) is visible.
  - The right edge of the area is split into three sections: Favourites, Trays, and Specials
  - Favourites are chosen by the user and will be retained
    - Drag a template to favs and it stays there
    - Drag an element to favs and it becomes a template there
    - Drag anything to favs that's already there and it will deduplicate (ie destroying the thing)
    - All templates, including in favs, can be double-clicked for more info, and will have a star
      to fav/unfav it.
  - Trays are predetermined. Precisely one tray will be selected at any given time. The default
    tray, on startup, is chosen by code (probably "text" or maybe "defaults").
    - Only the current tray can be interacted with, but other trays need to be hinted at somehow.
  - Specials currently contains just one thing: Trash. It's always below the current tray.
  - The visible elements are: FAvourites, the Current Tray, and Specials. Together, FACTS.
* An "Element" is anything that can be interacted with. An "Active" is something that can be saved,
  and is everything that isn't in the Favs/Trays/Specials.
  - The anchor point may belong in Actives or may belong in Specials. Uncertain.

Eventually this will go into StilleBot as an alternative command editor. Saving will be via the exact same
JSON format that the current editor uses, making them completely compatible. Note that information that
cannot be represented in JSON (eg exact pixel positions, and unanchored elements) will be lost on save/load.

There will always be an anchor whose text (and possibly colour) will be determined by what we are
editing (command, trigger, special, etc). Some anchors will offer information the way builtins do, others
will be configurable (eg triggers). Other anchors have special purposes (eg Trash) and are not saved.
*/
import {on, fix_dialogs} from "https://rosuav.github.io/shed/chocfactory.js";
fix_dialogs({close_selector: ".dialog_cancel,.dialog_close", click_outside: "formless"});

const SNAP_RANGE = 100; //Distance-squared to permit snapping (25 = 5px radius)
const canvas = document.querySelector("canvas");
const ctx = canvas.getContext('2d');

const types = {
	anchor: {
		fixed: true, children: ["message"], labelfixed: true,
	},
	text: {
		labellabel: "Text",
		typedesc: "A message to be sent. Normally spoken in the channel, but paint can affect this.",
	},
	builtin: {
		children: ["message"],
		labellabel: "Source", labelfixed: true,
		typedesc: "Fetch extra information. TODO: Show the precise extra info for this builtin.",
	},
	conditional: {
		children: ["message", "otherwise"],
		labellabel: "Condition",
		typedesc: "Make a decision - if it's true, do one thing, otherwise do something else.",
	},
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
			connections.push({x: 10, y, name: type.children[i], index: c});
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
	return path_cache[cache_key] = {path, connections, totheight: y};
}
const actives = [
	{type: "anchor", x: 10, y: 10, color: "#ffff00", label: "When !foo is typed...", message: [""],
		labellabel: "Invocation", desc: "This is how everything starts. You can't change this."},
];
const favourites = [];
const trays = {
	Default: [
		{type: "text", color: "#77eeee", label: "Create new text message", newlabel: "Sample text message"},
		{type: "conditional", color: "#7777ee", label: "Create new conditional", newlabel: "If..."},
		{type: "builtin", color: "#ee77ee", label: "Fetch extra information", newlabel: "TODO -- builtin"},
	],
	Builtins: [
		{type: "builtin", color: "#ee77ee", label: "Channel uptime"},
		{type: "builtin", color: "#ee77ee", label: "Shoutout"},
		{type: "builtin", color: "#ee77ee", label: "Calculator"},
	],
};
function make_template(el) {
	el.template = true;
	for (let attr of types[el.type].children || []) el[attr] = [""];
	return el; //For ease of adding into favs
}
Object.values(trays).forEach(t => t.forEach(e => make_template(e)));
let current_tray = "Default";
const trashcan = {type: "anchor", color: "#999999", label: "Trash", message: [""],
	labellabel: "Trash can", desc: "Anything dropped here can be retrieved until you next reload, otherwise it's gone forever."};
const specials = [trashcan];
let facts = []; //FAvourites, Current Tray, and Specials. All the elements in the templates column.
function refactor() {facts = [].concat(favourites, trays[current_tray], specials);} refactor();
window.set_tray = t => {current_tray = t; refactor(); repaint();} //HACK: Allow manual tray selection
const tray_x = canvas.width - 20; let tray_y; //tray_y is calculated during repaint
const template_x = tray_x - 205, template_y = 10;

function draw_at(ctx, el, parent, reposition) {
	if (el === "") return;
	if (reposition) {el.x = parent.x + reposition.x; el.y = parent.y + reposition.y;}
	const path = element_path(el);
	ctx.save();
	ctx.translate(el.x|0, el.y|0);
	ctx.fillStyle = el.color;
	ctx.fill(path.path);
	ctx.fillStyle = "black";
	ctx.font = "12px sans";
	let desc = types[el.type].fixed ? "" : "⣿ ";
	if (el.template) desc = "⯇ ";
	if (el.label) desc += el.label;
	ctx.fillText(desc, 20, 20, 175);
	ctx.stroke(path.path);
	ctx.restore();
	const children = types[el.type].children || [];
	let conn = path.connections, cc = 0;
	for (let i = 0; i < children.length; ++i) {
		const childset = el[children[i]];
		for (let c = 0; c < childset.length; ++c) {
			draw_at(ctx, childset[c], el, conn[cc++]);
		}
	}
}

function repaint() {
	ctx.clearRect(0, 0, canvas.width, canvas.height);
	//SPLITPOINT: Draw facts, then actives
	const h = favourites.map(el => element_path(el).totheight + 10).reduce((x,y) => x + y, 40)
	ctx.fillStyle = "#eeffee";
	ctx.fillRect(template_x - 10, template_y, 220, h);
	ctx.strokeRect(template_x - 10, template_y, 220, h);
	ctx.font = "12px sans"; ctx.fillStyle = "black";
	ctx.fillText("> Drop here to save favourites <", template_x + 15, template_y + 15, 175);
	let y = template_y + 40;
	const render = set => set.forEach(el => {
		el.x = template_x; el.y = y;
		draw_at(ctx, el);
		y += element_path(el).totheight + 10;
	});
	render(favourites);
	tray_y = y += 10;
	render(trays[current_tray]);
	render(specials);
	actives.forEach(el => el.parent || draw_at(ctx, el));
	
}
repaint();

function remove_child(childset, idx) {
	while (++idx < childset.length) {
		const cur = childset[idx - 1] = childset[idx];
		if (cur === "") continue;
		//assert cur.parent is array
		//assert cur.parent[0][cur.parent[1]] is childset
		cur.parent[2]--;
	}
	childset.pop(); //assert returns ""
}

function element_at_position(x, y, filter) {
	//Two loops to avoid constructing unnecessary arrays
	for (let el of actives) {
		if (filter && !filter(el)) continue;
		if (ctx.isPointInPath(element_path(el).path, x - el.x, y - el.y)) return el;
	}
	for (let el of facts) {
		if (filter && !filter(el)) continue;
		if (ctx.isPointInPath(element_path(el).path, x - el.x, y - el.y)) return el;
	}
}

let dragging = null, dragbasex = 50, dragbasey = 10;
canvas.addEventListener("pointerdown", e => {
	if (e.button) return; //Only left clicks
	e.preventDefault();
	e.target.setPointerCapture(e.pointerId);
	dragging = null;
	let el = element_at_position(e.offsetX, e.offsetY, el => !types[el.type].fixed);
	if (!el) return;
	if (el.template) {
		//Clone and spawn.
		el = {...el, template: false, label: el.newlabel || el.label, fresh: true};
		for (let attr of types[el.type].children || []) el[attr] = [""];
		actives.push(el);
		refactor();
	}
	dragging = el; dragbasex = e.offsetX - el.x; dragbasey = e.offsetY - el.y;
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
});

function has_parent(child, parent) {
	while (child) {
		if (child === parent) return true;
		if (!child.parent) return false;
		child = child.parent[0];
	}
}

function snap_to_elements(xpos, ypos) {
	//TODO: Optimize this?? We should be able to check against only those which are close by.
	//SPLITPOINT: Snap to actives, then check specials (no snap points on templates)
	for (let el of [...actives, ...specials]) { //TODO: Don't make pointless arrays
		if (el.template || has_parent(el, dragging)) continue;
		const path = element_path(el);
		for (let conn of path.connections || []) {
			if (el[conn.name][conn.index] !== "") continue;
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
	if (!dragging) return;
	e.target.releasePointerCapture(e.pointerId);
	//Recalculate connections only on pointer-up. (Or would it be better to do it on pointer-move?)
	let parent, conn;
	[dragging.x, dragging.y, parent, conn] = snap_to_elements(e.offsetX - dragbasex, e.offsetY - dragbasey);
	if (dragging.x > template_x - 100) {
		//Dropping something anywhere over the templates (or rather, so its center of mass is over templates)
		//will dump it on the trash. It can be retrieved until save, otherwise it's gone forever.
		if (dragging.fresh) {
			//It's been picked up off the template but never dropped. Just discard it.
			//SPLITPOINT: Will always be in actives
			let idx = actives.length - 1;
			//It's highly unlikely, but possible, that two pointers could simultaneously drag fresh items
			//and then the earlier one dragged is the one that gets dropped back on the template.
			if (dragging !== actives[idx]) idx = actives.indexOf(dragging);
			actives.splice(idx, 1);
			refactor();
			dragging = null; repaint();
			return;
		}
		for (let c of element_path(trashcan).connections) {
			if (trashcan.message[c.index] === "") {
				parent = trashcan; conn = c;
				break;
			}
		}
	}
	delete dragging.fresh;
	if (parent) {
		const childset = parent[conn.name];
		childset[conn.index] = dragging;
		dragging.parent = [parent, conn.name, conn.index];
		if (conn.index === childset.length - 1) childset.push(""); //Ensure there's always an empty slot at the end
	}
	dragging = null;
	repaint();
});

let propedit = null;
canvas.addEventListener("dblclick", e => {
	e.stopPropagation();
	const el = element_at_position(e.offsetX, e.offsetY);
	if (!el) return;
	if (el.template) return; //TODO: Pop up some info w/o allowing changes
	propedit = el;
	const type = types[el.type];
	set_content("#labellabel", type.labellabel || el.labellabel);
	set_content("#typedesc", type.typedesc || el.desc);
	DOM("[name=label]").value = el.label;
	DOM("[name=label]").disabled = type.labelfixed;
	set_content("#properties form button", "Close");
	DOM("#properties").showModal();
});

on("input", "#properties input", e => set_content("#properties form button", "Apply changes"));

on("submit", "#setprops", e => {
	const type = types[propedit.type];
	if (!type.labelfixed) propedit.label = DOM("[name=label]").value;
	propedit = null;
	e.match.closest("dialog").close();
	repaint();
});
