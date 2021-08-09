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

function draw_at(ctx, path, x, y) {
	ctx.save();
	ctx.translate(x, y);
	ctx.stroke(path);
	ctx.restore();
}

function repaint() {
	const ctx = canvas.getContext('2d');
	const anchor = build_anchor();
	draw_at(ctx, anchor, 10, 10);
	draw_at(ctx, anchor, 10, 80);
}
repaint();
