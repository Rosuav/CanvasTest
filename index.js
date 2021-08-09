const canvas = document.querySelector("canvas");
function draw_anchor(ctx, x, y) {
	ctx.beginPath();
	ctx.moveTo(x, y);
	ctx.lineTo(x + 200, y);
	ctx.lineTo(x + 200, y + 30);
	ctx.lineTo(x + 50, y + 30);
	//ctx.lineTo(x + 40, y + 20);
	//ctx.lineTo(x + 30, y + 30);
	ctx.arc(x + 40, y + 30, 10, 0, Math.PI, true);
	ctx.lineTo(x, y + 30);
	ctx.closePath();
	ctx.stroke();
}

function repaint() {
	const ctx = canvas.getContext('2d');
	draw_anchor(ctx, 10, 10);
}
repaint();
