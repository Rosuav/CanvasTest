const canvas = document.querySelector("canvas");
function build_anchor() {
	const path = new Path2D;
	path.moveTo(0, 0);
	path.lineTo(200, 0);
	path.lineTo(200, 30);
	path.lineTo(50, 30);
	//path.lineTo(40, 20); //Angled snipped
	//path.lineTo(30, 30);
	path.arc(40, 30, 10, 0, Math.PI, true); //Curved snippet
	path.lineTo(0, 30);
	path.closePath();
	return path
}

const objects = {
	anchor: build_anchor(),
}

const elements = [
	["anchor", 10, 10],
	["anchor", 10, 80],
];

function draw_at(ctx, path, x, y) {
	ctx.save();
	ctx.translate(x, y);
	ctx.stroke(objects[path]);
	ctx.restore();
}

function repaint() {
	const ctx = canvas.getContext('2d');
	ctx.clearRect(0, 0, canvas.width, canvas.height);
	elements.forEach(el => draw_at(ctx, ...el));
}
repaint();

let dragging = -1, dragbasex = 50, dragbasey = 10;
canvas.addEventListener("mousedown", e => {
	if (e.button) return; //Only left clicks
	//TODO: See which, if any, element is under the mouse
	console.log("Dragging!", e.offsetX, e.offsetY);
	dragging = 0; //Hack
});

canvas.addEventListener("mousemove", e => {
	if (dragging < 0) return;
	const el = elements[dragging];
	el[1] = e.offsetX - dragbasex;
	el[2] = e.offsetY - dragbasey;
	repaint();
});

canvas.addEventListener("mouseup", e => dragging = -1);
