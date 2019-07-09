const shelljs = require("shelljs");
const renderComment = require("reddit-comment-renderer");
const fetch = require("node-fetch");
const fs = require("fs");
const txttomp3 = require("text-to-mp3"); // crappy module but it works

async function concat(dir, output) {
	await exec(`for f in ./${dir}/*.mp4; do echo "file '$PWD/$f'"; done > dump/files`, { silent: true });
	await exec(`ffmpeg -f concat -safe 0 -i dump/files -c copy ${dir}/${output}`, { silent: true }, data => {
		let frame;
		if (data.match(/frame=.*?(\d+)/) && (frame = data.match(/frame=.*?(\d+)/)[1])) console.log(`Frame: ${frame}`);
	});
}

function mp3(text, fileName) {
	return new Promise((resolve, reject) => {
		txttomp3.getMp3(text, (err, binaryStream) => {
			if (err) reject(new Error(err));
			var file = fs.createWriteStream(fileName);
			file.write(binaryStream);
			file.end();
			resolve();
		});
	});
}

async function createFiles(username, comment, upvotes, timestamp, folder) {
	// Render screenshot
	var segments = comment.match(/(?:[^;:,\.!\?]|[;:,\.!\?](?![\s"'\)]))+[;:,\.!\?"'\)]*/g);
	var text = "";
	var files = [];

	for (var i = 0; i < segments.length; i++) {
		var segment = segments[i];
		text += segment;
		renderComment(username, text, upvotes, timestamp, 1920, 1080, 3, `./dump/${folder}/comment-${i+1}.png`);
		await mp3(segment, `./dump/${folder}/audio-${i+1}.mp3`);
		files.push({ image: `./dump/${folder}/comment-${i+1}.png`, audio: `./dump/${folder}/audio-${i+1}.mp3` });
	}

	return files;
}

function merge(image, audio, output) {
	// ffmpeg -loop 1 -i ${image} -i ${audio} -c:v libx264 -tune stillimage -c:a aac -b:a 192k -pix_fmt yuv420p -shortest ${output}
	return exec(`ffmpeg -y -framerate 1/$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 ${audio}) -i ${image} -i ${audio} -c:v libx264 -pix_fmt yuv420p -c:a aac -strict experimental -shortest ${output}`, { silent: true }, data => {
		let frame;
		if (data.match(/frame=.*?(\d+)/) && (frame = data.match(/frame=.*?(\d+)/)[1])) console.log(`Frame: ${frame}`);
	});
}

function exec(cmd, opts, stderrData, stdoutData) {
	return new Promise((resolve, reject) => {
		var child = shelljs.exec(cmd, opts, (code, stdout, stderr) => {
			if (code !== 0) return reject(new Error(stderr));
			return resolve(stdout);
		});
		if (stdoutData) child.stdout.on("data", stdoutData);
		if (stderrData) child.stderr.on("data", stderrData);
	});
}

var usedPosts = require("./posts.json");
(async () => {
	const sub = "AskReddit";
	const maxComments = 3;

	// // Get post
	console.log("Getting post.");
	var req = await fetch(`https://gateway.reddit.com/desktopapi/v1/subreddits/${sub}?&sort=top&t=day`);
	var json = await req.json();
	for (let id of Object.keys(json.posts)) {
		var post = json.posts[id]
		post.id = post.id.split("_")[1];
		if (!post.isSponsored && usedPosts.indexOf(post.id) === -1) break;
	}
	usedPosts.push(post.id);
	fs.writeFileSync("./posts.json", JSON.stringify(usedPosts));
	console.log(`Post: ${post.title}`);

	// Get comments
	console.log("Getting comments.");
	req = await fetch(`https://www.reddit.com/r/AskReddit/comments/${post.id}/.json?sort=top&limit=${maxComments}`);
	var comments = (await req.json())[1].data.children.filter(i => i.kind === "t1").map(i => i.data);

	// // Delete dump folder if it exists.
	try { await exec("rm -rf dump", { silent: true }) } catch {}

	// Create dump folder
	await exec("mkdir dump dump/clips");
	console.log("Dump folder created.");

	// Create & merge files
	for (var i = 0; i < comments.length; i++) {
		await exec(`mkdir dump/comment-${i+1}`);
		console.log(`Created dump/comment-${i+1}`);
		var comment = comments[i];
		var files = await createFiles(comment.author, comment.body, comment.ups.toString(), comment.created.toString(), `comment-${i+1}`);
		for (var j = 0; j < files.length; j++) {
			let { image, audio } = files[j];
			console.log(`Creating ./dump/comment-${i+1}/clip-${j+1}.mp4`);
			await merge(image, audio, `./dump/comment-${i+1}/clip-${j+1}.mp4`);
		}
		console.log(`Creating ./dump/clips/clip-${i+1}.mp4`);
		await concat(`dump/comment-${i+1}`, `../clips/clip-${i+1}.mp4`);
	}

	// Concatenate clips
	console.log("Creating out.mp4");
	await concat("dump/clips", "../out.mp4");
})();