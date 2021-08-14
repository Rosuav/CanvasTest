/* TODO

* Drag paint to element to set attributes (eg a "voice" paint)
* Have a small button on the element or something that shows the properties? Can be done with double click,
  but maybe it'd be better to have a more visually obvious indicator?
* Saving of favourites. ??? WHERE???
* Builtins (and some anchor types) provide replaceable values.
* Favs with children push or cross the edge of the box - functional but ugly. Collapse them?? Fade out?
* Message attributes still to implement:
  - dest="/web", target
  - dest="/w", target
  - dest="/set", target, action="add" or ""
    - For each of these, provide a small number of classes that do this with one message
    - Have a fallback like unknown-builtin to cope with any others (it won't be in the toolbox).
  - access="mod", "vip", "none" -- paint!
  - visibility="hidden" -- paint!
  - casefold on all string-based conditionals
  - voice=ID -- paint? What if it's set on just one message - how should that be imported?
    - Maybe have an element that changes voice for its children, but not in toolbox??
  - aliases?? Edit the anchor??
* Note that some legacy forms (eg dest="/builtin shoutout %s") are not supported and will not be. If you
  have an old command in this form, edit and save it in the default or raw UIs, then open this one.
* Toolbar for paint
  - Trapezoid at y=0, anchoring to top (like a tab but facing the other way
  - Each paint is a set of icons for its options
  - Paint that applies only to the anchor is one shape (eg circle), paint that applies to any element is
    another (eg square). Each one has N+1 targets (same as child connection points) for paint. Anchor
    gets both types of targets.
  - Drag from paint to anywhere over the element and it snaps to the target for that type.
  - Some paint will have effect on the subtree. For now, this will not be visually shown.
* Paint can now be flags. Because, internally, they're called that anyway.
  - In the toolbox and on the command, they are represented with icons (or emoji)
  - While being dragged, or possibly when clicked on, unfurl the flag to show a short description.
  - Flags mount on top of the anchor. They unfurl to the right (since I'm assuming English text here).
  - While being dragged, is element. Otherwise, is not. Dropping needs to apply flag and dispose of
    dragging. Painting needs to show all flags (in a consistent order).
  - Snap to position?

An "Element" is anything that can be interacted with. An "Active" is something that can be saved,
and is everything that isn't in the Favs/Trays/Specials.
  - The anchor point may belong in Actives or may belong in Specials. Uncertain.

TODO: If you drop a tree into favs, should you be able to drag it from anywhere? (Same if template.)
Should it grab the whole tree or just the subtree you clicked on? (Probably the former.)

Eventually this will go into StilleBot as an alternative command editor. Saving will be via the exact same
JSON format that the current editor uses, making them completely compatible. Note that information that
cannot be represented in JSON (eg exact pixel positions, and unanchored elements) will be lost on save/load.

There will always be an anchor whose text (and possibly colour) will be determined by what we are
editing (command, trigger, special, etc). Some anchors will offer information the way builtins do, others
will be configurable (eg triggers). Other anchors have special purposes (eg Trash) and are not saved.
*/
import choc, {set_content, DOM, on, fix_dialogs} from "https://rosuav.github.io/shed/chocfactory.js";
const {LABEL, INPUT, SELECT, OPTION, TR, TD} = choc;
fix_dialogs({close_selector: ".dialog_cancel,.dialog_close", click_outside: "formless"});

const SNAP_RANGE = 100; //Distance-squared to permit snapping (25 = 5px radius)
const canvas = document.querySelector("canvas");
const ctx = canvas.getContext('2d');

const arrayify = x => Array.isArray(x) ? x : [x];
const ensure_blank = arr => {
	if (arr[arr.length - 1] !== "") arr.push(""); //Ensure the usual empty
	return arr;
};

const types = {
	anchor: {
		color: "#ffff00", fixed: true, children: ["message"],
		label: el => el.label,
	},
	//Types can apply zero or more attributes to a message, each one with a set of valid values.
	//Validity can be defined by an array of strings (take your pick), a single string (fixed value,
	//cannot change), undefined (allow user to type), or an array of three numbers [min, max, step],
	//which define a range of numeric values.
	//If the value is editable (ie not a fixed string), also provide a label for editing.
	//These will be detected in the order they are iterated over.
	//TODO: Which things should be elements and which should be paint??
	//Paint's job is to reduce the size of the visible tree. If we don't have any paint, this tree will
	//be *larger* than the one in the vanilla editor, since each element can apply at most one attribute
	//(although it might still be clearer, in complicated cases where evaluation order matters). But
	//what makes some things work better as paint and others as elements?
	delay: {
		color: "#77ee77", children: ["message"], label: el => `Delay ${el.delay} seconds`,
		params: [{attr: "delay", label: "Delay (seconds)", values: [1, 7200, 1]}],
		typedesc: "Delay the children by a certain length of time",
	},
	builtin_uptime: {
		color: "#ee77ee", children: ["message"], label: el => "Channel uptime",
		params: [{attr: "builtin", values: "uptime"}],
		typedesc: "Check the channel's uptime - {uptime} - and fetch the channel name {channel}",
	},
	builtin_shoutout: {
		color: "#ee77ee", children: ["message"], label: el => "Shoutout",
		params: [{attr: "builtin", values: "shoutout"}, {attr: "builtin_param", label: "Channel name"}],
		typedesc: "Fetch information about another channel and what it has recently streamed",
	},
	builtin_calc: {
		color: "#ee77ee", children: ["message"], label: el => "Calculator",
		params: [{attr: "builtin", values: "calc"}, {attr: "builtin_param", label: "Expression"}],
		typedesc: "Perform arithmetic calculations",
	},
	builtin_hypetrain: {
		color: "#ee77ee", children: ["message"], label: el => "Hype train status",
		params: [{attr: "builtin", values: "hypetrain"}],
		typedesc: "Get info about a current or recent hype train in this channel",
	},
	builtin_giveaway: {
		color: "#ee77ee", children: ["message"], label: el => "Giveaway tools",
		params: [
			{attr: "builtin", values: "mpn"},
			{attr: "builtin_param", values: ["refund", "status"]},
		],
		typedesc: "Handle giveaways via channel point redemptions",
	},
	builtin_mpn: {
		color: "#ee77ee", children: ["message"], label: el => "Multi-Player Notepad",
		params: [{attr: "builtin", values: "mpn"}], //Not currently editable. Needs a lot of work.
		typedesc: "Manipulate MPN documents. Not well supported yet.",
	},
	builtin_pointsrewards: {
		color: "#ee77ee", children: ["message"], label: el => "Points Rewards",
		params: [{attr: "builtin", values: "pointsrewards"}], //Not currently editable. Needs reward ID and a set of commands. Might not be worth doing properly.
		typedesc: "Manipulate channel point rewards",
	},
	builtin_transcoding: {
		color: "#ee77ee", children: ["message"], label: el => "Transcoding",
		params: [{attr: "builtin", values: "transcoding"}],
		typedesc: "Check whether the channel has transcoding (quality options)",
	},
	builtin_other: {
		color: "#ee77ee", children: ["message"], label: el => "Unknown Builtin: " + el.builtin,
		params: [{attr: "builtin", label: "Builtin name"}],
		typedesc: "Unknown builtin - either a malformed command or one that this editor cannot display.",
	},
	conditional_string: {
		color: "#7777ee", children: ["message", "otherwise"], label: el => ["String comparison", "Otherwise:"],
		params: [{attr: "conditional", values: "string"}, {attr: "expr1", label: "Expression 1"}, {attr: "expr2", label: "Expression 2"}],
		typedesc: "Make a decision - if THIS is THAT, do one thing, otherwise do something else.",
	},
	conditional_contains: {
		color: "#7777ee", children: ["message", "otherwise"], label: el => ["String includes", "Otherwise:"],
		params: [{attr: "conditional", values: "contains"}, {attr: "expr1", label: "Needle"}, {attr: "expr2", label: "Haystack"}],
		typedesc: "Make a decision - if Needle in Haystack, do one thing, otherwise do something else.",
	},
	conditional_regexp: {
		color: "#7777ee", children: ["message", "otherwise"], label: el => ["Regular expression", "Otherwise:"],
		params: [{attr: "conditional", values: "regexp"}, {attr: "expr1", label: "Reg Exp"}, {attr: "expr2", label: "Compare against"}],
		typedesc: "Make a decision - if regular expression, do one thing, otherwise do something else.",
	},
	conditional_number: {
		color: "#7777ee", children: ["message", "otherwise"], label: el => ["Numeric computation", "Otherwise:"],
		params: [{attr: "conditional", values: "number"}, {attr: "expr1", label: "Expression"}],
		typedesc: "Make a decision - if the result's nonzero, do one thing, otherwise do something else.",
	},
	cooldown: {
		color: "#aacc55", children: ["message", "otherwise"], label: el => [el.cdlength + "-second cooldown", "If on cooldown:"],
		params: [{attr: "cdlength", label: "Delay (seconds)", values: [1, 7200, 1]}, {attr: "cdname", label: "Tag (optional)"}],
		typedesc: "Prevent the command from being used too quickly. If it's been used recently, the second block happens instead.",
	},
	random: {
		color: "#ee7777", children: ["message"], label: el => "Randomize",
		params: [{attr: "mode", label: "Randomize", values: "random"}],
		typedesc: "Choose one child at random and show it",
	},
	text: {
		color: "#77eeee", label: el => el.message,
		params: [{attr: "message", label: "Text"}],
		typedesc: "A message to be sent. Normally spoken in the channel, but paint can affect this.",
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
	const connections = [], labelpos = [20];
	if (type.children) for (let i = 0; i < type.children.length; ++i) {
		if (i) {
			//For second and subsequent children, add a separator bar and room for a label.
			path.lineTo(200, y);
			path.lineTo(200, y += 20);
			labelpos.push(y - 5);
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
	return path_cache[cache_key] = {path, connections, totheight: y, labelpos};
}
const actives = [
	{type: "anchor", x: 10, y: 10, label: "When !foo is typed...", message: [""],
		desc: "This is how everything starts. You can't change this."},
];
const favourites = [];
const trays = {
	Default: [
		{type: "text", message: "Sample text message"},
		//{type: "text", value: "Shh this is a whisper"}, //TODO
		{type: "delay", delay: "2"},
		{type: "random"},
		{type: "cooldown", cdlength: "30", cdname: ""},
	],
	Builtins: [
		{type: "builtin_uptime"},
		{type: "builtin_shoutout", builtin_param: "%s"},
		{type: "builtin_calc", builtin_param: "1 + 2 + 3"},
	],
	Conditionals: [
		{type: "conditional_string", expr1: "%s", expr2: "demo"},
		{type: "conditional_contains", expr1: "/foo/bar/quux/", expr2: "/%s/"},
		{type: "conditional_number", expr1: "$deaths$ > 10"},
		//NOTE: Even though they're internally conditionals too, cooldowns don't belong in this tray
	],
};
const tray_tabs = [
	{name: "Default", color: "#efdbb2"},
	{name: "Builtins", color: "#f7bbf7"},
	{name: "Conditionals", color: "#bbbbf7"},
];
function make_template(el, par) {
	if (el === "") return;
	//Remove this element from actives if present. Note that this is quite inefficient
	//on recursive templates, but I don't really care.
	const idx = actives.indexOf(el);
	if (idx !== -1) actives.splice(idx, 1);
	el.template = true;
	if (par && el.parent) el.parent[0] = par;
	for (let attr of types[el.type].children || []) {
		if (!el[attr]) el[attr] = [""];
		else el[attr].forEach(e => make_template(e, el));
	}
}
Object.values(trays).forEach(t => t.forEach(e => make_template(e)));
let current_tray = "Default";
const trashcan = {type: "anchor", color: "#999999", label: "Trash - drop here to discard", message: [""],
	desc: "Anything dropped here can be retrieved until you next reload, otherwise it's gone forever."};
const specials = [trashcan];
let facts = []; //FAvourites, Current Tray, and Specials. All the elements in the templates column.
function refactor() {facts = [].concat(favourites, trays[current_tray], specials);} refactor();
const tab_width = 15, tab_height = 80;
const tray_x = canvas.width - tab_width - 5; let tray_y; //tray_y is calculated during repaint
const template_x = tray_x - 210, template_y = 10;
const paintbox_x = 230, paintbox_height = 25;
const paintbox_width = template_x - paintbox_x - tab_width * 2; //Should this be based on the amount of stuff in it?
let traytab_path = null, paintbox_path = null;
let dragging = null, dragbasex = 50, dragbasey = 10;

//Each flag set, identified by its attribute name, offers a number of options.
//Each option has an emoji icon, optionally a colour, and a long desc used when dragging.
//There must always be an empty-string option, which is also used if the attribute isn't set.
const flags = {
	access: {
		"none": {icon: "🔒", desc: "Access: None (command disabled)"},
		"mod": {icon: "🗡", iconcolor: "#00aa00", desc: "Access: Mods only"},
		"vip": {icon: "💎", desc: "Access: Mods/VIPs"},
		"": {icon: "👪", desc: "Access: Everyone"},
	},
	visibility: {
		"": {icon: "🔒", desc: "Visible/public command"},
		"hidden": {icon: "🗡", desc: "Hidden/secret command"},
	},
};
	
function draw_at(ctx, el, parent, reposition) {
	if (el === "") return;
	if (reposition) {el.x = parent.x + reposition.x; el.y = parent.y + reposition.y;}
	const path = element_path(el);
	const type = types[el.type];
	ctx.save();
	ctx.translate(el.x|0, el.y|0);
	ctx.fillStyle = el.color || type.color;
	ctx.fill(path.path);
	ctx.fillStyle = "black";
	ctx.font = "12px sans";
	const labels = arrayify(type.label(el));
	if (el.template) labels[0] = "⯇ " + labels[0];
	else if (!type.fixed) labels[0] = "⣿ " + labels[0];
	for (let i = 0; i < labels.length; ++i) ctx.fillText(labels[i].slice(0, 28), 20, path.labelpos[i], 175);
	ctx.stroke(path.path);
	ctx.restore();
	const children = type.children || [];
	let conn = path.connections, cc = 0;
	for (let i = 0; i < children.length; ++i) {
		const childset = el[children[i]];
		for (let c = 0; c < childset.length; ++c) {
			draw_at(ctx, childset[c], el, conn[cc++]);
		}
	}
}

function render(set, y) {
	set.forEach(el => {
		el.x = template_x; el.y = y;
		draw_at(ctx, el);
		y += element_path(el).totheight + 10;
	});
}
function boxed_set(set, color, desc, y) {
	const h = set.map(el => element_path(el).totheight + 10).reduce((x,y) => x + y, 30)
	ctx.fillStyle = color;
	ctx.fillRect(template_x - 10, y, 220, h);
	ctx.strokeRect(template_x - 10, y, 220, h);
	ctx.font = "12px sans"; ctx.fillStyle = "black";
	ctx.fillText(desc, template_x + 15, y + 19, 175);
	render(set, y + 30);
	return y + h + 10;
}

function repaint() {
	ctx.clearRect(0, 0, canvas.width, canvas.height);
	tray_y = boxed_set(favourites, "#eeffee", "> Drop here to save favourites <", template_y);
	//Draw the tabs down the side of the tray
	let tab_y = tray_y + tab_width, curtab_y = 0, curtab_color = "#00ff00";
	if (!traytab_path) {
		traytab_path = new Path2D;
		traytab_path.moveTo(0, 0);
		traytab_path.lineTo(tab_width, tab_width);
		traytab_path.lineTo(tab_width, tab_height - tab_width / 2);
		traytab_path.lineTo(0, tab_height + tab_width / 2);
	}
	for (let tab of tray_tabs) {
		tab.y = tab_y;
		if (tab.name === current_tray) {curtab_y = tab_y; curtab_color = tab.color;} //Current tab is drawn last in case of overlap
		else {
			ctx.save();
			ctx.translate(tray_x, tab_y);
			ctx.fillStyle = tab.color;
			ctx.fill(traytab_path);
			ctx.stroke(traytab_path);
			ctx.restore();
		}
		tab_y += tab_height;
	}
	let spec_y = boxed_set(trays[current_tray], curtab_color, "Current tray: " + current_tray, tray_y);
	if (curtab_y) {
		//Draw the current tab
		ctx.save();
		ctx.translate(tray_x, curtab_y);
		//Remove the dividing line. It might still be partly there but this makes the tab look connected.
		ctx.strokeStyle = curtab_color;
		ctx.strokeRect(0, 0, 0, tab_height + tab_width / 2);
		ctx.fillStyle = curtab_color; ctx.strokeStyle = "black";
		ctx.fill(traytab_path);
		ctx.stroke(traytab_path);
		ctx.restore();
	}
	render(specials, spec_y + 25);

	if (!paintbox_path) {
		paintbox_path = new Path2D;
		paintbox_path.moveTo(0, 0);
		paintbox_path.lineTo(tab_width, paintbox_height);
		paintbox_path.lineTo(paintbox_width - tab_width, paintbox_height);
		paintbox_path.lineTo(paintbox_width, 0);
	}
	ctx.save();
	ctx.translate(paintbox_x, 0);
	ctx.fillStyle = "#efdbb2";
	ctx.fill(paintbox_path);
	ctx.stroke(paintbox_path);
	ctx.font = "12px sans"; ctx.fillStyle = "#00aa00";
	ctx.fillText("🔒", 25, 17);
	ctx.fillText("🗡", 45, 17);
	ctx.fillText("💎", 65, 17);
	ctx.fillText("👪", 85, 17);
	ctx.restore();

	actives.forEach(el => el.parent || el === dragging || draw_at(ctx, el));
	if (dragging) draw_at(ctx, dragging); //Anything being dragged gets drawn last, ensuring it is at the top of z-order.
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

function clone_template(t, par) {
	if (t === "") return "";
	const el = {...t};
	delete el.template;
	actives.push(el);
	if (par && el.parent) el.parent[0] = par;
	for (let attr of types[el.type].children || [])
		el[attr] = el[attr].map(e => clone_template(e, el));
	return el;
}

canvas.addEventListener("pointerdown", e => {
	if (e.button) return; //Only left clicks
	e.preventDefault();
	if (e.offsetX >= tray_x) {
		for (let tab of tray_tabs) {
			if (e.offsetY >= tab.y && e.offsetY <= tab.y + tab_height) {
				current_tray = tab.name;
				refactor(); repaint();
			}
		}
		return;
	}
	dragging = null;
	let el = element_at_position(e.offsetX, e.offsetY, el => !types[el.type].fixed);
	if (!el) return;
	e.target.setPointerCapture(e.pointerId);
	if (el.template) {
		//Clone and spawn.
		el = clone_template(el);
		el.fresh = true;
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

//Check if two templates are functionally equivalent, based on saveable attributes
function same_template(t1, t2) {
	if (t1 === "" && t2 === "") return true;
	if (t1 === "" || t2 === "") return false;
	if (t1.type !== t2.type) return false;
	const type = types[t1.type];
	if (type.params) for (let p of type.params)
		if (t1[p.attr] !== t2[p.attr]) return false;
	for (let attr of type.children || []) {
		const c1 = t1[attr], c2 = t2[attr];
		if (c1.length !== c2.length) return false;
		for (let i = 0; i < c1.length; ++i)
			if (!same_template(c1[i], c2[i])) return false;
	}
	return true;
}

canvas.addEventListener("pointerup", e => {
	if (!dragging) return;
	e.target.releasePointerCapture(e.pointerId);
	//Recalculate connections only on pointer-up. (Or would it be better to do it on pointer-move?)
	let parent, conn;
	[dragging.x, dragging.y, parent, conn] = snap_to_elements(e.offsetX - dragbasex, e.offsetY - dragbasey);
	if (dragging.x > template_x - 100) {
		//Dropping something over the favourites (the top section of templates) will save it as a
		//favourite. Dropping it anywhere else (over templates, over trash, or below the trash)
		//will dump it on the trash. It can be retrieved until save, otherwise it's gone forever.
		if (dragging.y < tray_y) {
			//Three possibilities.
			//1) A favourite was dropped back onto favs (while still fresh)
			//   - Discard it. It's a duplicate.
			//2) A template was dropped onto favs (while still fresh)
			//   - Save as fav, discard the dragged element.
			//3) A non-fresh element was dropped
			//   - Remove the draggable element and add to favs.
			//They all function the same way, though: remove the Active, add to Favourites,
			//but deduplicate against all other Favourites.
			let dupe = false;
			make_template(dragging);
			for (let f of favourites) {
				if (same_template(f, dragging)) {dupe = true; break;}
			}
			if (!dupe) //In Python, this would be a for-else clause
				favourites.push(dragging);
			refactor();
			dragging = null; repaint();
			return;
		}
		if (dragging.fresh) {
			//It's been picked up off the template but never dropped. Just discard it.
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
	set_content("#typedesc", type.typedesc || el.desc);
	set_content("#params", type.params.map(param => {
		let control, id = {name: "value-" + param.attr, id: "value-" + param.attr};
		switch (typeof param.values) {
			//"object" has to mean array, we don't support any other type
			case "object": if (param.values.length === 3 && typeof param.values[0] === "number") {
				const [min, max, step] = param.values;
				control = INPUT({...id, type: "number", min, max, step, value: el[param.attr]});
			} else {
				control = SELECT(id, param.values.map(v => OPTION(v))); //TODO: Allow value and description to differ
			}
			break;
			case "undefined": control = INPUT({...id, value: el[param.attr] || "", size: 50}); break;
			default: break; //incl fixed strings
		}
		return control && TR([TD(LABEL({htmlFor: "value-" + param.attr}, param.label + ": ")), TD(control)]);
	}));
	set_content("#properties form button", "Close");
	DOM("#properties").showModal();
});

on("input", "#properties input", e => set_content("#properties form button", "Apply changes"));

on("submit", "#setprops", e => {
	const type = types[propedit.type];
	for (let param of type.params) {
		const val = document.getElementById("value-" + param.attr);
		if (val) {
			//TODO: Validate based on the type, to prevent junk data from hanging around until save
			//Ultimately the server will validate, but it's ugly to let it sit around wrong.
			propedit[param.attr] = val.value;
		}
	}
	propedit = null;
	e.match.closest("dialog").close();
	repaint();
});

function element_to_message(el) {
	if (el === "") return "";
	const ret = { };
	const type = types[el.type];
	if (type.children) for (let attr of type.children) {
		ret[attr] = el[attr].filter(e => e !== "").map(element_to_message);
	}
	if (type.params) type.params.forEach(p => ret[p.attr] = el[p.attr]);
	return ret;
}

function matches(param, val) {
	//See if the value is compatible with this parameter's definition of values.
	switch (typeof param.values) {
		//"object" has to mean array, we don't support any other type
		case "object": if (param.values.length === 3 && typeof param.values[0] === "number") {
			const num = parseFloat(val);
			const [min, max, step] = param.values;
			return num >= min && min <= max && !((num - min) % step);
		} else returntype.values.includes(val);
		case "undefined": return typeof val === "string";
		case "string": return param.values === val;
		default: return false;
	}
}
const new_elem = el => {actives.push(el); return el;}; //HACK: Easier to add to array here than to collect them afterwards
function message_to_element(msg) {
	if (typeof msg === "string") return new_elem({type: "text", message: msg});
	if (Array.isArray(msg)) return msg.map(message_to_element);
	for (let typename in types) {
		const type = types[typename];
		if (type.params && type.params.every(p => matches(p, msg[p.attr]))) {
			const el = new_elem({type: typename});
			for (let param of type.params) {
				el[param.attr] = msg[param.attr];
				delete msg[type.attr];
			}
			if (type.children) for (let attr of type.children) {
				el[attr] = ensure_blank(arrayify(msg[attr]).map(message_to_element));
				el[attr].forEach((e, i) => typeof e === "object" && (e.parent = [el, attr, i]));
			}
			return el;
		}
	}
	if (msg.message) return message_to_element(msg.message);
	return new_elem({type: "text", color: "#ff0000", label: "Shouldn't happen", value: "Shouldn't happen"});
}

on("click", "#open_json", e => {
	//Starting at the anchor, recursively calculate an echoable message which will create
	//the desired effect.
	//assert actives[0].type === "anchor"
	const msg = element_to_message(actives[0]);
	DOM("#jsontext").value = JSON.stringify(msg);
	DOM("#jsondlg").showModal();
});

on("submit", "#jsondlg form", e => {
	const msg = JSON.parse(DOM("#jsontext").value);
	actives.splice(1); //Truncate
	const el = message_to_element(msg);
	actives[0].message = ensure_blank(arrayify(el));
	actives[0].message.forEach((e, i) => typeof e === "object" && (e.parent = [actives[0], "message", i]));
	e.match.closest("dialog").close();
	console.log(actives);
	refactor(); repaint();
});
