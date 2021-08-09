/* TODO

* Template objects. Drag from them to spawn new elements, but they won't leave their places.
  - If you drop back onto a template, despawn the dragged element
* Extending connection bars. If a parent has children attached, lengthen the bar to allow one more.
* Parents track their attached children
* Children move with parent. A draggable parent drags its children (by the ear, probably).
* Multiple child connection points
* Export to JSON
* Edit attributes on double-click
* Drag paint to element
* Element colour (and opacity)
* Create paths as required, and cache them. Identify required paths by their parent and child counts.
* Element types define the number of child *groups* but not the number of children.

*/

const SNAP_RANGE = 100; //Distance-squared to permit snapping (25 = 5px radius)
const canvas = document.querySelector("canvas");
const ctx = canvas.getContext('2d');
function build_element_path(has_parent, child_count) {
	const path = new Path2D;
	path.moveTo(0, 0);
	path.lineTo(200, 0);
	path.lineTo(200, 30);
	if (child_count) { //TODO: Handle multiple children (eg conditionals)
		path.lineTo(10, 30);
		path.lineTo(10, 35);
		path.arc(10, 45, 10, Math.PI * 3 / 2, Math.PI / 2, false);
		path.lineTo(10, 70);
		path.lineTo(0, 70);
	}
	path.lineTo(0, 30);
	if (has_parent) { //Object has a connection point on its left edge
		path.lineTo(0, 25);
		path.arc(0, 15, 10, Math.PI / 2, Math.PI * 3 / 2, true);
	}
	path.closePath();
	return path;
}

const objects = {
	anchor: build_element_path(0, 1),
	text: build_element_path(1, 0),
};
const connections = {
	anchor: [{x: 10, y: 30, name: "message"}],
};

const elements = [
	{type: "anchor", x: 10, y: 10, fixed: true},
	{type: "text", x: 10, y: 100},
];

function draw_at(ctx, el) {
	ctx.save();
	ctx.translate(el.x|0, el.y|0);
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
		for (let conn of connections[el.type] || []) {
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
