/* TODO

Integration with StilleBot.
* Saving of favourites - send to the server, they'll be validated, and associated with your user ID.
  - Should be part of the websocket sync so they appear instantly on all clients
* Deduplicate a ton of data by getting it from the server instead of hard-coding.
  - Builtins and their vars_provided
  - Specials and their SPECIALS and SPECIAL_PARAMS (maybe filter out deprecateds?)
* Save and load, obviously. Pretty straight-forward and the infrastructure is already there.
* List of available voices and their names

Note that some legacy forms are not supported and will not be. If you have an old command in such a
form, edit and save it in the default or raw UIs, then open this one.

Some particularly hairy types of operations are not available in tools, but can be imported, and
are then able to be saved into favs. Maybe I'll eventually make a separate tray for them??

An "Element" is anything that can be interacted with. An "Active" is something that can be saved,
and is everything that isn't in the Favs/Trays/Specials.
  - The primary anchor point may belong in Actives or may belong in Specials. Uncertain.
*/
import choc, {set_content, DOM, on, fix_dialogs} from "https://rosuav.github.io/shed/chocfactory.js";
const {BUTTON, DIV, LABEL, INPUT, SELECT, OPTION, TR, TD, TEXTAREA, LI, CODE} = choc;
fix_dialogs({close_selector: ".dialog_cancel,.dialog_close", click_outside: "formless"});

const SNAP_RANGE = 100; //Distance-squared to permit snapping (eg 25 = 5px radius)
const canvas = document.querySelector("canvas");
const ctx = canvas.getContext('2d');
const FAV_BUTTON_TEXT = ["Fav ☆", "Fav ★"];
const voices_available = {"": "Default", "279141671": "Mustard Mine"}; //Will be provided by the server

const arrayify = x => Array.isArray(x) ? x : [x];
const ensure_blank = arr => {
	if (arr[arr.length - 1] !== "") arr.push(""); //Ensure the usual empty
	return arr;
};

function required(val) {return !!val;} //Filter that demands that an attribute be present

const types = {
	anchor_command: {
		color: "#ffff00", fixed: true, children: ["message"],
		label: el => `When ${el.command} is typed...`, //TODO: Also mention aliases
		typedesc: "This is how everything starts. Drag flags onto this to apply them.",
		params: [{attr: "aliases", label: "Aliases"}], //TODO: Validate format? Explain? Or maybe have "Add alias" and "Remove alias" buttons?
		provides: {
			"{param}": "Anything typed after the command name",
			"{username}": "Name of the user who entered the command",
			"{@mod}": "1 if the command was triggered by a mod/broadcaster, 0 if not",
		},
	},
	anchor_trigger: {
		color: "#ffff00", fixed: true, children: ["message"],
		label: el => el.conditional === "contains" ? `When '${el.expr1}' is typed...` : `When a msg matches ${el.expr1} ...`,
		params: [{attr: "conditional", label: "Match type", values: ["contains", "regexp"],
				selections: {string: "Simple match", regexp: "Regular expression"}},
			{attr: "casefold", label: "Case insensitive", values: true},
			{attr: "id", label: null}, //Retain the ID but don't show it for editing
			{attr: "expr1", label: "Search for"}, {attr: "expr2", values: "%s"}],
		provides: {
			"{param}": "Anything typed after the command name",
			"{username}": "Name of the user who entered the command",
			"{@mod}": "1 if the command was triggered by a mod/broadcaster, 0 if not",
		},
	},
	anchor_special: {
		//Specials are... special. The details here will vary based on which special we're editing (this is !!musictrack).
		color: "#ffff00", fixed: true, children: ["message"],
		label: el => "When a song starts...",
		typedesc: "A track just started playing (see VLC integration)",
		provides: {
			"{desc}": "Human-readable description of what's playing (block and track names)",
			"{blockpath}": "Full path to the current block",
			"{block}": "Name of the section/album/block of tracks currently playing, if any",
			"{track}": "Name of the audio file that's currently playing",
			"{playing}": "1 if music is playing, or 0 if paused, stopped, disconnected, etc",
		},
	},
	trashcan: {
		color: "#999999", fixed: true, children: ["message"],
		label: el => "Trash - drop here to discard",
		typedesc: "Anything dropped here can be retrieved until you next reload, otherwise it's gone forever.",
	},
	//Types can apply zero or more attributes to a message, each one with a set of valid values.
	//Validity can be defined by an array of strings (take your pick), a single string (fixed value,
	//cannot change), undefined (allow user to type), or an array of three numbers [min, max, step],
	//which define a range of numeric values.
	//If the value is editable (ie not a fixed string), also provide a label for editing.
	//These will be detected in the order they are iterated over.
	delay: {
		color: "#77ee77", children: ["message"], label: el => `Delay ${el.delay} seconds`,
		params: [{attr: "delay", label: "Delay (seconds)", values: [1, 7200, 1]}],
		typedesc: "Delay message(s) by a certain length of time",
	},
	voice: {
		color: "#bbbb33", children: ["message"], label: el => "Change voice",
		params: [{attr: "voice", label: "Voice", values: Object.keys(voices_available), selections: voices_available}],
		typedesc: "Select a different voice for messages - only available if alternate voices are authorized",
	},
	builtin_uptime: {
		color: "#ee77ee", children: ["message"], label: el => "Channel uptime",
		params: [{attr: "builtin", values: "uptime"}],
		typedesc: "See if the channel is online, and if so, for how long",
		provides: {
			"{uptime}": "Number of seconds the channel has been online, or 0 if offline",
			"{channel}": "Channel name (may later become the display name)",
		},
	},
	builtin_shoutout: {
		color: "#ee77ee", children: ["message"], label: el => "Shoutout",
		params: [{attr: "builtin", values: "shoutout"}, {attr: "builtin_param", label: "Channel name"}],
		typedesc: "Fetch information about another channel and what it has recently streamed",
		provides: {
			"{url}": "Channel URL, or blank if the user wasn't found",
			"{name}": "Display name of the user",
			"{category}": "Current or last-seen category (game)",
			"{catdesc}": "Category in a human-readable form, eg 'playing X' or 'creating Art'",
			"{title}": "Current or last-seen stream title",
		},
	},
	builtin_calc: {
		color: "#ee77ee", children: ["message"], label: el => "Calculator",
		params: [{attr: "builtin", values: "calc"}, {attr: "builtin_param", label: "Expression"}],
		typedesc: "Perform arithmetic calculations",
		provides: {
			"{error}": "Blank if all is well, otherwise an error message",
			"{result}": "The result of the calculation",
		},
	},
	builtin_hypetrain: {
		color: "#ee77ee", children: ["message"], label: el => "Hype train status",
		params: [{attr: "builtin", values: "hypetrain"}],
		typedesc: "Get info about a current or recent hype train in this channel",
		provides: {
			"{error}": "Normally blank, but can have an error message",
			"{state}": "A keyword (idle, active, cooldown). If idle, there's no other info; if cooldown, info pertains to the last hype train.",
			"{level}": "The level that we're currently in (1-5)",
			"{total}": "The total number of bits or bits-equivalent contributed towards this level",
			"{goal}": "The number of bits or bits-equivalent to complete this level",
			"{needbits}": "The number of additional bits required to complete this level (== goal minus total)",
			"{needsubs}": "The number of Tier 1 subs that would complete this level",
			"{conductors}": "Either None or a list of the current conductors",
			"{subs_conduct}": "Either Nobody or the name of the current conductor for subs",
			"{bits_conduct}": "Either Nobody or the name of the current conductor for bits",
			"{expires}": "Minutes:Seconds until the hype train runs out of time (only if Active)",
			"{cooldown}": "Minutes:Seconds until the next hype train can start (only if Cooldown)",
		},
	},
	builtin_giveaway: {
		color: "#ee77ee", children: ["message"], label: el => "Giveaway tools",
		params: [
			{attr: "builtin", values: "chan_giveaway"},
			{attr: "builtin_param", label: "Action", values: ["refund", "status"]},
		],
		typedesc: "Handle giveaways via channel point redemptions",
		provides: {
			"{error}": "Error message, if any",
			"{action}": "Action taken - same as subcommand, or 'none' if there was nothing to do",
			"{tickets}": "Number of tickets you have (or had)",
		},
	},
	builtin_mpn: {
		color: "#ee77ee", children: ["message"], label: el => "Multi-Player Notepad",
		params: [{attr: "builtin", values: "chan_mpn"}, {attr: "builtin_param", label: "Action"}], //Not currently editable. Needs a lot of work.
		typedesc: "Manipulate MPN documents. Not well supported yet.",
		provides: {
			"{error}": "Error message, if any",
			"{action}": "Action performed (if any)",
			"{url}": "URL to the manipulated document, blank if no such document",
		},
	},
	builtin_pointsrewards: {
		color: "#ee77ee", children: ["message"], label: el => "Points Rewards",
		params: [{attr: "builtin", values: "chan_pointsrewards"}, {attr: "builtin_param", label: "Action"}], //Not usefully editable. Needs reward ID and a set of commands. Might not be worth doing properly.
		typedesc: "Manipulate channel point rewards",
		provides: {
			"{error}": "Error message, if any",
			"{action}": "Action(s) performed, if any (may be blank)",
		},
	},
	builtin_transcoding: {
		color: "#ee77ee", children: ["message"], label: el => "Transcoding",
		params: [{attr: "builtin", values: "transcoding"}],
		typedesc: "Check whether the channel has transcoding (quality options)",
		provides: {
			"{resolution}": "Source resolution eg 1920x1080",
			"{qualities}": "Comma-separated list of additional qualities - if blank, no transcoding",
		},
	},
	builtin_other: {
		color: "#ee77ee", children: ["message"], label: el => "Unknown Builtin: " + el.builtin,
		params: [{attr: "builtin", label: "Builtin name", values: required}, {attr: "builtin_param", label: "Parameter"}],
		typedesc: "Unknown builtin - either a malformed command or one that this editor does not recognize.",
	},
	conditional_string: {
		color: "#7777ee", children: ["message", "otherwise"], label: el => [
			el.expr1 && el.expr2 ? el.expr1 + " == " + el.expr2 : "String comparison",
			"Otherwise:",
		],
		params: [{attr: "conditional", values: "string"}, {attr: "casefold", label: "Case insensitive", values: true},
			{attr: "expr1", label: "Expression 1"}, {attr: "expr2", label: "Expression 2"}],
		typedesc: "Make a decision - if THIS is THAT, do one thing, otherwise do something else.",
	},
	conditional_contains: {
		color: "#7777ee", children: ["message", "otherwise"], label: el => ["String includes", "Otherwise:"],
		params: [{attr: "conditional", values: "contains"}, {attr: "casefold", label: "Case insensitive", values: true},
			{attr: "expr1", label: "Needle"}, {attr: "expr2", label: "Haystack"}],
		typedesc: "Make a decision - if Needle in Haystack, do one thing, otherwise do something else.",
	},
	conditional_regexp: {
		color: "#7777ee", children: ["message", "otherwise"], label: el => ["Regular expression", "Otherwise:"],
		params: [{attr: "conditional", values: "regexp"}, {attr: "casefold", label: "Case insensitive", values: true},
			{attr: "expr1", label: "Reg Exp"}, {attr: "expr2", label: "Compare against"}],
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
	whisper_back: {
		color: "#99ffff", width: 400, label: el => "🤫 " + el.message,
		params: [{attr: "dest", values: "/w"}, {attr: "target", values: "$$"}, {attr: "message", label: "Text"}],
		typedesc: "Whisper to the person who ran the command",
	},
	whisper_other: {
		color: "#99ffff", children: ["message"], label: el => "🤫 to " + el.target,
		params: [{attr: "dest", values: "/w"}, {attr: "target", label: "Person to whisper to"}],
		typedesc: "Whisper to a specific person",
	},
	web_message: {
		color: "#99ffff", children: ["message"], label: el => "🌏 to " + el.target,
		params: [{attr: "dest", values: "/web"}, {attr: "target", label: "Recipient"}],
		typedesc: "Leave a private message for someone",
	},
	incr_variable: {
		color: "#dd7777", label: el => `Add ${el.message} to $${el.target}$`,
		params: [{attr: "dest", values: "/set"}, {attr: "action", values: "add"},
			{attr: "target", label: "Variable name"}, {attr: "message", label: "Increment by"}],
		typedesc: "Update a variable. Can be accessed as $varname$ in this or any other command.",
	},
	incr_variable_complex: {
		color: "#dd7777", children: ["message"], label: el => `Add onto $${el.target}$`,
		params: [{attr: "dest", values: "/set"}, {attr: "action", values: "add"},
			{attr: "target", label: "Variable name"},],
		typedesc: "Capture message as a variable update. Can be accessed as $varname$ in this or any other command.",
	},
	set_variable: {
		color: "#dd7777", label: el => `Set $${el.target}$ to ${el.message}`,
		params: [{attr: "dest", values: "/set"}, {attr: "target", label: "Variable name"}, {attr: "message", label: "New value"}],
		typedesc: "Change a variable. Can be accessed as $varname$ in this or any other command.",
	},
	set_variable_complex: {
		color: "#dd7777", children: ["message"], label: el => `Change variable $${el.target}$`,
		params: [{attr: "dest", values: "/set"}, {attr: "target", label: "Variable name"},],
		typedesc: "Capture message into a variable. Can be accessed as $varname$ in this or any other command.",
	},
	random: {
		color: "#ee7777", children: ["message"], label: el => "Randomize",
		params: [{attr: "mode", label: "Randomize", values: "random"}],
		typedesc: "Choose one child at random and show it",
	},
	text: {
		color: "#77eeee", width: 400, label: el => el.message,
		params: [{attr: "message", label: "Text"}],
		typedesc: "Send a message in the channel",
	},
	group: {
		color: "#66dddd", children: ["message"], label: el => "Group",
		typedesc: "Group some elements for convenience. Has no inherent effect.",
	},
	flag: {
		color: "#aaddff", label: el => el.icon,
		style: "flag", width: 25,
	},
	dragflag: {
		color: "#aaddff", label: el => el.icon + " " + el.desc,
		style: "flag", width: 150,
	},
};

const path_cache = { };
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
	const width = type.width || 200;
	path.moveTo(0, 0);
	if (type.style === "flag") {
		path.lineTo(width, 0);
		path.bezierCurveTo(width + 4, 12, width - 4, 5, width, 20); //Curve on the edge of the flag
		path.lineTo(5, 20);
		path.lineTo(5, 35);
		path.lineTo(0, 35);
		path.closePath();
		return path_cache[cache_key] = {path, connections: [], totheight: 30, labelpos: [14]};
	}
	path.lineTo(width, 0);
	path.lineTo(width, 30);
	let y = 30;
	const connections = [], labelpos = [20];
	if (type.children) for (let i = 0; i < type.children.length; ++i) {
		if (i) {
			//For second and subsequent children, add a separator bar and room for a label.
			path.lineTo(width, y);
			path.lineTo(width, y += 20);
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
	{type: "anchor_command", x: 10, y: 25, command: "!demo", aliases: "", message: [""]},
	//{type: "anchor_special", x: 10, y: 25, message: [""]},
	//{type: "anchor_trigger", x: 10, y: 25, message: [""], conditional: "contains", expr1: "", expr2: "%s"},
];
const favourites = [];
const trays = { };
const tray_tabs = [
	{name: "Default", color: "#efdbb2", items: [
		{type: "text", message: "Sample text message"},
		{type: "random"},
		{type: "conditional_string", expr1: "%s"},
		{type: "cooldown", cdlength: "30", cdname: ""},
	]},
	{name: "Advanced", color: "#f7bbf7", items: [
		{type: "whisper_back", message: "Shh! This is a whisper!"},
		{type: "incr_variable", target: "deaths", message: "1"},
		{type: "set_variable", target: "deaths", message: "0"},
		{type: "builtin_uptime"},
		{type: "builtin_shoutout", builtin_param: "%s"},
		{type: "builtin_calc", builtin_param: "1 + 2 + 3"},
	]},
	{name: "Conditionals", color: "#bbbbf7", items: [
		{type: "conditional_contains", expr1: "/foo/bar/quux/", expr2: "/%s/"},
		{type: "conditional_number", expr1: "$deaths$ > 10"},
		//NOTE: Even though they're internally conditionals too, cooldowns don't belong in this tray
	]},
	{name: "Special", color: "#bbffbb", items: [
		{type: "delay", delay: "2"},
		{type: "group", message: [
			{type: "web_message", target: "{param}", message: [
				{type: "text", message: "This is a top secret message."},
			]},
			{type: "text", message: "A secret message has been sent to you at: https://sikorsky.rosuav.com/channels/{param}/private"},
		]},
	]},
];
function make_template(el, par) {
	if (el === "") return;
	//Remove this element from actives if present. Note that this is quite inefficient
	//on recursive templates, but I don't really care.
	const idx = actives.indexOf(el);
	if (idx !== -1) actives.splice(idx, 1);
	el.template = true;
	if (par) el.parent = par;
	for (let attr of types[el.type].children || []) {
		if (!el[attr]) el[attr] = [""];
		else ensure_blank(el[attr]).forEach((e, i) => make_template(e, [el, attr, i]));
	}
}
tray_tabs.forEach(t => (trays[t.name] = t.items).forEach(e => make_template(e)));
let current_tray = "Default";
const trashcan = {type: "trashcan", message: [""]};
const specials = [trashcan];
let facts = []; //FAvourites, Current Tray, and Specials. All the elements in the templates column.
function refactor() {facts = [].concat(favourites, trays[current_tray], specials);}
const tab_width = 15, tab_height = 70;
const tray_x = canvas.width - tab_width - 5; let tray_y; //tray_y is calculated during repaint
const template_x = tray_x - 210, template_y = 10;
const paintbox_x = 250, paintbox_height = 40;
const paintbox_width = 250; //Should this be based on the amount of stuff in it?
let traytab_path = null, paintbox_path = null;
let dragging = null, dragbasex = 50, dragbasey = 10;

//Each flag set, identified by its attribute name, offers a number of options.
//Each option has an emoji icon, optionally a colour, and a long desc used when dragging.
//There must always be an empty-string option, which is also used if the attribute isn't set.
const flags = {
	access: {
		"none": {icon: "🔒", desc: "Access: None"},
		"mod": {icon: "🗡️", color: "#44bb44", desc: "Access: Mods"},
		"vip": {icon: "💎", color: "#ff88ff", desc: "Access: Mods/VIPs"},
		"": {icon: "👪", desc: "Access: Everyone"},
	},
	visibility: {
		"": {icon: "🌞", desc: "Public command"},
		"hidden": {icon: "🌚", desc: "Secret command"},
	},
};
function make_flag_flags() {
	let x = paintbox_x;
	for (let attr in flags) {
		for (let value in flags[attr]) {
			const f = flags[attr][value];
			f.type = "flag"; f.template = true;
			f.x = x += 30; f.y = 2;
			f.attr = attr; f.value = value;
			specials.push(f);
		}
		x += 20;
	}
}
make_flag_flags(); refactor();

const textlimit_cache = { };
function limit_width(ctx, txt, width) {
	const key = ctx.font + ":" + width + ":" + txt;
	if (textlimit_cache[key]) return textlimit_cache[key];
	//Since we can't actually ask the text renderer for character positions, we have to do it ourselves.
	//First try: See if the entire text fits.
	let metrics = ctx.measureText(txt);
	if (width === "") return textlimit_cache[key] = metrics.width; //Actually we're just doing a cached measurement.
	if (metrics.width <= width) return textlimit_cache[key] = txt; //Perfect, all fits.
	//We have to truncate. Second try: The other extreme - a single ellipsis.
	if (limit_width(ctx, "…", "") > width) return ""; //Wow that is super narrow... there's no hope for you.
	//Okay. So we can fit an ellipsis, but not the whole text. Search for the truncation
	//that fits, but such that even a single additional character wouldn't.
	//Our first guess is the proportion of the string that would fit, if every character
	//had the same width.
	let guess = Math.floor((width / metrics.width) * txt.length);
	let fits = 0, spills = 0; //These will never legitly be zero, since a length of 1 should fit
	//Having made a guess based on an assumption which, while technically invalid, is actually
	//fairly plausible for most text, we then jump four characters at a time to try to find a
	//span that contains the limit. From that point, we binary search (which should take exactly
	//two more steps) to get our final result. Under normal circumstances, the first two guesses
	//will already span the goal, so the total number of probes will be four, plus the full text
	//above; if the text is a bit more skewed, it might be five. This is better than a naive
	//binary search for any text longer than 32 characters, and anything shorter than that will
	//fit anyway. The flip side is that pathological examples like "w"*30 + "i"*1000 will take
	//ridiculously large numbers of probes to try to resolve. I don't think that's solvable.
	while (!fits || !spills || (spills - fits) > 1) {
		const w = limit_width(ctx, txt.slice(0, guess) + "…", "");
		if (w <= width) fits = guess; else spills = guess;
		if (!fits) guess -= guess > 4 ? 4 : 1;
		else if (!spills) guess += guess < txt.length - 4 ? 4 : 1;
		else guess = Math.floor((fits + spills) / 2);
		if (guess === fits || guess === spills) break; //Shouldn't happen, but just in case...
	}
	return textlimit_cache[key] = txt.slice(0, fits) + "…";
}

let max_descent = 0;
function draw_at(ctx, el, parent, reposition) {
	if (el === "") return;
	if (reposition) {el.x = parent.x + reposition.x; el.y = parent.y + reposition.y;}
	const path = element_path(el);
	max_descent = Math.max(max_descent, (el.y|0) + path.totheight);
	const type = types[el.type];
	ctx.save();
	ctx.translate(el.x|0, el.y|0);
	ctx.fillStyle = el.color || type.color;
	ctx.fill(path.path);
	ctx.fillStyle = "black";
	ctx.font = "12px sans";
	const labels = arrayify(type.label(el));
	let label_x = 20;
	if (type.style === "flag") label_x = 6; //Hack!
	else if (el.template) labels[0] = "⯇ " + labels[0];
	else if (!type.fixed) labels[0] = "⣿ " + labels[0];
	const w = (type.width || 200) - label_x;
	for (let i = 0; i < labels.length; ++i) ctx.fillText(limit_width(ctx, labels[i], w), label_x, path.labelpos[i]);
	ctx.stroke(path.path);
	let flag_x = 220;
	for (let attr in flags) {
		const flag = flags[attr][el[attr]];
		if (flag && el[attr] !== "") {
			draw_at(ctx, {...flag, x: flag_x -= 30, y: -24});
		}
	}
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
//NOTE: The color *must* be a string of the form "#rrggbb" as it will have alpha added
function boxed_set(set, color, desc, y) {
	const h = set.map(el => element_path(el).totheight + 10).reduce((x,y) => x + y, 30)
	ctx.save();
	ctx.fillStyle = color;
	ctx.fillRect(template_x - 10, y, 220, h);
	ctx.strokeRect(template_x - 10, y, 220, h);
	ctx.font = "12px sans"; ctx.fillStyle = "black";
	ctx.fillText(desc, template_x + 15, y + 19, 175);
	ctx.beginPath();
	ctx.rect(template_x - 9, y, 218, h);
	ctx.clip();
	render(set, y + 30);
	//Fade wide elements out by overlaying them with the background colour in ever-increasing alpha
	const fade_right = ctx.createLinearGradient(template_x + 200, 0, template_x + 210, 0);
	fade_right.addColorStop(0, color + "00");
	fade_right.addColorStop(1, color);
	ctx.fillStyle = fade_right;
	ctx.fillRect(template_x + 200, y, 10, h);
	ctx.restore();
	return y + h + 10;
}

function repaint() {
	ctx.clearRect(0, 0, canvas.width, canvas.height);
	max_descent = 600; //Base height, will never shrink shorter than this
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
	trashcan.x = template_x; trashcan.y = spec_y + 25;

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
	ctx.restore();
	specials.forEach(el => draw_at(ctx, el));

	actives.forEach(el => el.parent || el === dragging || draw_at(ctx, el));
	if (dragging) draw_at(ctx, dragging); //Anything being dragged gets drawn last, ensuring it is at the top of z-order.
	if (max_descent != canvas.height) {canvas.height = max_descent; repaint();}
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

//Check if an element contains the given (x,y) position.
//If this or any of its children contains it, return the child which does.
function element_contains(el, x, y) {
	if (el === "") return null; //Empty slots contain nothing.
	if (ctx.isPointInPath(element_path(el).path, x - el.x, y - el.y)) return el;
	for (let attr of types[el.type].children || [])
		for (let child of el[attr] || []) {
			let c = element_contains(child, x, y);
			if (c) return c;
		}
	return null;
}

function element_at_position(x, y, filter) {
	for (let el of actives) {
		//Actives check only themselves, because children of actives are themselves actives,
		//and if you grab a child out of an element, it should leave its parent and go and
		//cleave to its mouse cursor.
		if (filter && !filter(el)) continue;
		if (ctx.isPointInPath(element_path(el).path, x - el.x, y - el.y)) return el;
	}
	for (let el of facts) {
		if (filter && !filter(el)) continue;
		//With facts, also descend to children - but if one matches, return the top-level.
		if (element_contains(el, x, y)) return el;
	}
}

function clone_template(t, par) {
	if (t === "") return "";
	const el = {...t};
	delete el.template;
	if (el.type === "flag") el.type = "dragflag"; //Hack - dragging a flag unfurls it (and doesn't add an active element)
	else actives.push(el);
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

function content_only(arr) {return (arr||[]).filter(el => el);} //Filter out any empty strings or null entries
//Check if two templates are functionally equivalent, based on saveable attributes
function same_template(t1, t2) {
	if (t1 === "" && t2 === "") return true;
	if (t1 === "" || t2 === "") return false;
	if (t1.type !== t2.type) return false;
	const type = types[t1.type];
	if (type.params) for (let p of type.params)
		if (t1[p.attr] !== t2[p.attr]) return false;
	for (let attr of type.children || []) {
		const c1 = content_only(t1[attr]), c2 = content_only(t2[attr]);
		if (c1.length !== c2.length) return false;
		for (let i = 0; i < c1.length; ++i)
			if (!same_template(c1[i], c2[i])) return false;
	}
	return true;
}
function is_favourite(el) {
	for (let f of favourites) {
		if (same_template(f, el)) return f;
	}
	return null;
}

canvas.addEventListener("pointerup", e => {
	if (!dragging) return;
	e.target.releasePointerCapture(e.pointerId);
	//Recalculate connections only on pointer-up. (Or would it be better to do it on pointer-move?)
	if (dragging.type === "dragflag") {
		//Special: Dragging a flag applies it to the anchor, or discards it. Nothing else.
		//TODO: Show this on pointer-move too
		let x = e.offsetX - dragbasex, y = e.offsetY - dragbasey;
		const anchor = actives[0]; //assert anchor.type =~ "anchor*"
		if (x >= anchor.x - 10 && x <= anchor.x + 220 && y >= anchor.y - 30 &&
				y <= anchor.y + element_path(anchor).totheight + 10) {
			anchor[dragging.attr] = dragging.value;
		}
		dragging = null;
		repaint();
		return;
	}
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
			make_template(dragging);
			if (!is_favourite(dragging)) {favourites.push(dragging); save_favourites();}
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

function make_message_editor(id, el) {
	//Collect up a list of parents in order from root to here
	//We scan upwards, inserting parents before us, to ensure proper ordering.
	//This keeps the display tidy (having {param} always first, for instance),
	//but also ensures that wonky situations with vars overwriting each other
	//will behave the way the back end would handle them.
	const vars_avail = [];
	for (let par = el; par; par = par.parent && par.parent[0]) {
		vars_avail.unshift(types[par.type].provides);
	}
	const allvars = Object.assign({}, ...vars_avail);
	return DIV({className: "msgedit"}, [
		DIV({className: "buttonbox"}, Object.entries(allvars).map(([v, d]) => BUTTON({type: "button", title: d, className: "insertvar", "data-insertme": v}, v))),
		TEXTAREA({...id, rows: 10, cols: 60}, el.message || ""),
	]);
}
on("mousedown", ".insertvar", e => e.preventDefault()); //Prevent buttons from taking focus when clicked
on("click", ".insertvar", e => {
	const mle = e.match.closest(".msgedit").querySelector("textarea");
	mle.setRangeText(e.match.dataset.insertme, mle.selectionStart, mle.selectionEnd, "end");
});

let propedit = null;
canvas.addEventListener("dblclick", e => {
	e.stopPropagation();
	const el = element_at_position(e.offsetX, e.offsetY);
	if (!el) return;
	propedit = el;
	const type = types[el.type];
	set_content("#toggle_favourite", FAV_BUTTON_TEXT[is_favourite(el) ? 1 : 0]).disabled = type.fixed;
	set_content("#typedesc", type.typedesc || el.desc);
	set_content("#params", (type.params||[]).map(param => {
		if (param.label === null) return null; //Note that a label of undefined is probably a bug and should be visible.
		let control, id = {name: "value-" + param.attr, id: "value-" + param.attr, disabled: el.template};
		switch (typeof param.values) {
			//"object" has to mean array, we don't support any other type
			case "object": if (param.values.length === 3 && typeof param.values[0] === "number") {
				const [min, max, step] = param.values;
				control = INPUT({...id, type: "number", min, max, step, value: el[param.attr]});
			} else {
				control = SELECT(id, param.values.map(v => OPTION({selected: v === el[param.attr], value: v}, (param.selections||{})[v] || v)));
			}
			break;
			case "undefined": case "function":
				if (param.attr === "message") control = make_message_editor(id, el);
				else control = INPUT({...id, value: el[param.attr] || "", size: 50});
				break;
			case "boolean": control = INPUT({...id, type: "checkbox", checked: el[param.attr] === "on"}); break;
			default: break; //incl fixed strings
		}
		return control && TR([TD(LABEL({htmlFor: "value-" + param.attr}, param.label + ": ")), TD(control)]);
	}));
	set_content("#providesdesc", Object.entries(type.provides || {}).map(([v, d]) => LI([
		CODE(v), ": " + d,
	])));
	set_content("#saveprops", "Close");
	DOM("#templateinfo").style.display = el.template ? "block" : "none";
	DOM("#properties").showModal();
});

on("click", "#toggle_favourite", e => {
	if (types[propedit.type].fixed) return;
	const f = is_favourite(propedit);
	if (f) {
		favourites.splice(favourites.indexOf(f), 1);
		set_content("#toggle_favourite", FAV_BUTTON_TEXT[0]);
	}
	else {
		const t = {...propedit, parent: null}; make_template(t);
		favourites.push(t);
		set_content("#toggle_favourite", FAV_BUTTON_TEXT[1]);
	}
	save_favourites();
	refactor(); repaint();
});

on("click", "#clonetemplate", e => {
	if (!propedit.template) return;
	const parent = actives[0];
	const path = element_path(parent);
	for (let conn of path.connections || []) {
		if (parent[conn.name][conn.index] !== "") continue;
		const childset = parent[conn.name];
		(childset[conn.index] = clone_template(propedit)).parent = [parent, conn.name, conn.index];
		if (conn.index === childset.length - 1) childset.push(""); //Ensure there's always an empty slot at the end
	}
	propedit = null;
	e.match.closest("dialog").close();
	repaint();
});

on("input", "#properties [name]", e => set_content("#saveprops", "Apply changes"));

on("submit", "#setprops", e => {
	const type = types[propedit.type];
	if (!propedit.template && type.params) for (let param of type.params) {
		const val = document.getElementById("value-" + param.attr);
		if (val) {
			//TODO: Validate based on the type, to prevent junk data from hanging around until save
			//Ultimately the server will validate, but it's ugly to let it sit around wrong.
			if (typeof param.values === "boolean") propedit[param.attr] = val.checked ? "on" : "";
			else propedit[param.attr] = val.value;
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
	if (type.params) type.params.forEach(p => ret[p.attr] = typeof p.values === "string" ? p.values : el[p.attr]);
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
		} else return param.values.includes(val);
		case "function": return param.values(val);
		case "undefined": return typeof val === "string" || typeof val === "undefined";
		case "boolean": return !val || val === "on";
		case "string": return param.values === val;
		default: return false;
	}
}

function apply_params(el, msg) {
	for (let param of types[el.type].params) {
		if (typeof param.values !== "string") el[param.attr] = msg[param.attr];
		//else assert msg[param.attr] === param.values
		delete msg[param.attr];
	}
}

function message_to_element(msg, new_elem, array_ok) {
	if (msg === "" || typeof msg === "undefined") return "";
	if (typeof msg === "string") return new_elem({type: "text", message: msg});
	if (Array.isArray(msg)) switch (msg.length) {
		case 0: return ""; //Empty array is an empty message
		case 1: return message_to_element(msg[0], new_elem, array_ok);
		default:
			msg = msg.map(el => message_to_element(el, new_elem));
			if (array_ok) return msg;
			return new_elem({type: "group", message: ensure_blank(msg)});
	}
	if (msg.dest && msg.dest.includes(" ") && !msg.target) {
		//Legacy mode: dest is eg "/set varname" and target is unset
		const words = msg.dest.split(" ");
		msg.dest = words.shift(); msg.target = words.join(" ");
	}
	for (let typename in types) {
		const type = types[typename];
		if (!type.fixed && type.params && type.params.every(p => matches(p, msg[p.attr]))) {
			const el = new_elem({type: typename});
			apply_params(el, msg);
			if (type.children) for (let attr of type.children) {
				if (attr === "message") el[attr] = ensure_blank(arrayify(message_to_element(msg, new_elem, true)));
				else el[attr] = ensure_blank(arrayify(msg[attr]).map(el => message_to_element(el, new_elem)));
				el[attr].forEach((e, i) => typeof e === "object" && (e.parent = [el, attr, i]));
			}
			return el;
		}
	}
	if (msg.message) return message_to_element(msg.message, new_elem, array_ok);
	return new_elem({type: "text", value: "Shouldn't happen"});
}

on("click", "#open_json", async e => {
	//Starting at the anchor, recursively calculate an echoable message which will create
	//the desired effect.
	const anchor = actives[0]; //assert anchor.type =~ "anchor*"
	const msg = element_to_message(anchor);
	apply_params(anchor, msg);
	for (let attr in flags) {
		const flag = flags[attr][anchor[attr]];
		if (flag && anchor[attr] !== "") msg[attr] = anchor[attr];
	}
	//When integrated, this will be done on the websocket, and will use the current channel
	//instead of this hacky hack.
	const canonical = await (await fetch("https://sikorsky.rosuav.com/channels/rosuav/commands", {
		method: "POST",
		body: JSON.stringify({msg, cmdname: anchor.type === "anchor_trigger" ? "!!trigger" : "!demo"}),
	})).json();
	DOM("#jsontext").value = JSON.stringify(canonical);
	DOM("#jsondlg").showModal();
});

function load_message(msg) {
	actives.splice(1); //Truncate
	if (typeof msg === "string" || Array.isArray(msg)) msg = {message: msg};
	for (let attr in flags) {
		actives[0][attr] = msg[attr] || "";
		delete msg[attr];
	}
	actives[0].message = ensure_blank(arrayify(message_to_element(msg, el => {actives.push(el); return el;}, true)));
	actives[0].message.forEach((e, i) => typeof e === "object" && (e.parent = [actives[0], "message", i]));
	refactor(); repaint();
}
on("submit", "#jsondlg form", e => {
	load_message(JSON.parse(DOM("#jsontext").value));
	e.match.closest("dialog").close();
});
//load_message({"builtin":"uptime","builtin_param":"%s","message":{"conditional":"string","expr1":"{uptime}","expr2":"0","message":"Channel is currently offline.","otherwise":"@$$: Channel {channel} has been online for {uptime|time_english} or {uptime|time_hms}."}});

//DBU violation, fix if you feel like it
function save_favourites() {
	localStorage.setItem("StilleBotGUI_Favourites", JSON.stringify(favourites.map(element_to_message)));
}

function load_favourites() {
	const favs = JSON.parse(localStorage.getItem("StilleBotGUI_Favourites") || "[]");
	if (!Array.isArray(favs)) return;
	const newfavs = favs.map(f => message_to_element(f, el => el));
	favourites.splice(0); //Replace all favs with the loaded ones.
	for (let f of newfavs) {
		if (!is_favourite(f)) {make_template(f); favourites.push(f);}
	}
	refactor(); repaint();
}
load_favourites();

function destfix(msg) { //Hack: Things compare equal if they match apart from this difference.
	if (msg.dest && msg.dest.includes(" ") && !msg.target) {
		//Legacy mode: dest is eg "/set varname" and target is unset
		const words = msg.dest.split(" ");
		msg.dest = words.shift(); msg.target = words.join(" ");
	}
}
//Compare two objects for deep equality. Prints all differences to the console.
//Returns true if objects are congruent.
function compare_recursive(obj1, obj2, path="") {
	let same = true;
	if (typeof obj1 !== typeof obj2) {console.log(path, " - Types differ:", typeof obj1, typeof obj2); return false;}
	if (typeof obj1 === "object") {
		if (Array.isArray(obj1) !== Array.isArray(obj2)) {console.log(path, " - Object/array mismatch"); return false;}
		if (Array.isArray(obj1)) {
			if (!compare_recursive(obj1.length, obj2.length, path + ".length")) return false;
			for (let i = 0; i < obj1.length; ++i) {
				if (!compare_recursive(obj1[i], obj2[i], `${path}[${i}]`)) same = false;
			}
		}
		else {
			destfix(obj1); destfix(obj2);
			//Is there a better way to get the union of all keys in both objects?
			const allkeys = [...new Set([...Object.keys(obj1), ...Object.keys(obj2)])];
			for (let key of allkeys) {
				if (!compare_recursive(obj1[key], obj2[key], path + "." + key)) same = false;
			}
		}
	}
	else {
		if (obj1 !== obj2) {console.log(path, " - Values differ:", obj1, obj2); same = false;}
	}
	return same;
}

let failures = 0;
async function probe(orig, cmdname, title) {
	let msg = JSON.parse(JSON.stringify(orig));
	//1) Load the message into an element tree
	const anchor = cmdname === "!!trigger"
		? {type: "anchor_trigger", x: 10, y: 25, message: [""], conditional: "contains", expr1: "", expr2: "%s"}
		: {type: "anchor_command", x: 10, y: 25, command: cmdname, aliases: "", message: [""]};
	if (typeof msg === "string" || Array.isArray(msg)) msg = {message: msg};
	apply_params(anchor, msg);
	for (let attr in flags) {
		anchor[attr] = msg[attr] || "";
		delete msg[attr];
	}
	anchor.message = ensure_blank(arrayify(message_to_element(msg, el => el, true)));
	anchor.message.forEach((e, i) => typeof e === "object" && (e.parent = [anchor, "message", i]));

	//2) Save the element tree back to an element
	const newmsg = element_to_message(anchor);
	for (let attr in flags) {
		const flag = flags[attr][anchor[attr]];
		if (flag && anchor[attr] !== "") newmsg[attr] = anchor[attr];
	}

	//3) Canonicalize and compare
	const canonical = await (await fetch("https://sikorsky.rosuav.com/channels/rosuav/commands", {
		method: "POST",
		body: JSON.stringify({msg: newmsg, cmdname}),
	})).json();
	if (compare_recursive(orig, canonical)) return;
	console.log(title);
	console.log("WAS:", orig); console.log("RAW:", newmsg); console.log("NOW:", canonical);
	++failures;
}

function sleep(delay) {return new Promise(r => setTimeout(r, delay));}

async function probe_all(...cmds) {
	//This won't work without a reference to the full StilleBot commands file, which - for obvious
	//reasons - isn't included in this repository.
	const allcmds = await (await fetch("twitchbot_commands.json")).json();
	if (typeof allcmds !== "object") return;
	if (!cmds.length) cmds = Object.keys(allcmds).sort(); //CAUTION: May hammer the server
	let count = 0;
	for (let cmd of cmds) {
		if (!allcmds[cmd] || allcmds[cmd].alias_of) continue;
		//if (cmd < "adc") continue; //Hack: Specify a start point
		if (cmd.startsWith("!trigger#")) {
			if (!Array.isArray(allcmds[cmd])) {console.log("TRIGGER NOT AN ARRAY"); continue;}
			for (let trig of allcmds[cmd])
				await probe(trig, "!!trigger", cmd);
		}
		else await probe(allcmds[cmd], "!" + cmd.split("#")[0], cmd);
		if (failures > 25) {console.warn("Lots of failures, deal with those before continuing"); break;}
		await sleep(125);
		if (++count === 100) {count = 0; console.log("... rate-limiting..."); await sleep(15000);}
	}
}
probe_all("hypetrain#beauation", "transcoding#pixalicious_");
//probe_all();
