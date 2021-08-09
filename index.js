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
	return path
}

const objects = {
	anchor: build_element_path(0, 1),
	text: build_element_path(1, 0),
}

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
canvas.addEventListener("mousedown", e => {
	if (e.button) return; //Only left clicks
	dragging = null;
	elements.forEach(el => {
		if (el.fixed) return;
		const x = e.offsetX - el.x, y = e.offsetY - el.y;
		if (ctx.isPointInPath(objects[el.type], x, y)) {
			dragging = el; dragbasex = x; dragbasey = y;
		}
	});
});

canvas.addEventListener("mousemove", e => {
	if (!dragging) return;
	dragging.x = e.offsetX - dragbasex;
	dragging.y = e.offsetY - dragbasey;
	repaint();
});

canvas.addEventListener("mouseup", e => dragging = null);
