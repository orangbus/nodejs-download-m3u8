const fs = require('fs');
const crypto = require('crypto');
const axios = require("axios");
const M3U8Parser = require("m3u8-parser");

const out = "download"; // 输出目录
const filename = "filename.txt"; // 输出文件名

// 检查文件路劲是否存在
if (!fs.existsSync(filename)) {
	console.log("下载文件不存在")
	return true;
}

if (!fs.existsSync(out)) {
	fs.mkdirSync(out);
}
if (!fs.existsSync(out+"/ts")) {
	fs.mkdirSync(out+"/ts");
}

// 读取文件列表
const file = fs.readFileSync(filename).toString().split("\n");
if (file.length == 0) {
	console.log("文件列表为空")
	return true;
}
const fileList = [];
file.forEach(item=>{
	let line = item.split(",")
	let temp = {};
	temp.name = line[0];
	if (line[1]){
		temp.url = line[1].replace(/\r/g, '');
		fileList.push(temp);
	}
})

console.log("累计下载文件："+fileList.length);

function decryptSegment (methods, key, iv, segmentData) {
	const decipher = crypto.createDecipheriv(methods, key, iv);
	const decryptedData = Buffer.concat([decipher.update(segmentData), decipher.final()]);
	return decryptedData;
}

async function downloadM3U8(filename,m3u8Url) {
	try {
		// 请求 m3u8 文件
		const response = await axios.get(m3u8Url);

		// 解析 m3u8 格式
		const parser = new M3U8Parser.Parser();
		parser.push(response.data);
		parser.end();

		const segments = parser.manifest.segments;

		const downloadPromises = []; // 并发下载数组

		// 下载秘钥
		let itemKey = segments[0].key.uri;
		if (!fs.existsSync(`download/ts/${itemKey}`)){
			const keyBaseUrl = m3u8Url.substring(0,m3u8Url.lastIndexOf('/') + 1) + itemKey;

			const keyResponse = await axios.get(keyBaseUrl, { responseType: 'arraybuffer' });
			fs.writeFileSync(`download/ts/${itemKey}`, keyResponse.data);
		}
		const keyContent = fs.readFileSync(`download/ts/${itemKey}`);
		const key = Buffer.from(keyContent, 'hex');
		const ivHex = '00000000000000000000000000000000'; // 根据实际的 M3U8 文件中的 IV 参数获取
		const iv = Buffer.from(ivHex, 'hex');
		const outputFilename = `download/${filename}.ts`;
		const outputStream = fs.createWriteStream(outputFilename);

		let totalDownloaded = 0;
		let prevTime = Date.now();
		const downloadSpeedInterval = 1000; // 每秒更新一次下载速度
		const maxConcurrentDownloads = 10; // 最大并发下载数

		// 执行下载
		for (let i = 0; i < segments.length; i++) {
			const segmentUrl = segments[i].uri;
			const segmentPromise = axios.get(segmentUrl, {
				responseType: 'arraybuffer',
				onDownloadProgress: progressEvent => {
					totalDownloaded += progressEvent.loaded;
				}
			});

			downloadPromises.push(segmentPromise);
			if (downloadPromises.length >= maxConcurrentDownloads || i === segments.length - 1) {
				const segmentResponses = await Promise.all(downloadPromises);

				for (let j = 0; j < segmentResponses.length; j++) {
					const segmentResponse = segmentResponses[j];
					const decryptedSegmentData = decryptSegment('aes-128-cbc', key, iv, segmentResponse.data);
					outputStream.write(decryptedSegmentData);
				}

				downloadPromises.length = 0; // 清空下载 Promise 数组
			}

			// 计算下载速度
			const currentTime = Date.now();
			if (currentTime - prevTime >= downloadSpeedInterval) {
				const elapsedTimeInSeconds = (currentTime - prevTime) / 1000;
				const downloadSpeed = (totalDownloaded / elapsedTimeInSeconds / 1024).toFixed(2); // 单位为 KB/s
				console.log(`下载速度：${downloadSpeed} KB/s`);
				totalDownloaded = 0;
				prevTime = currentTime;
			}

		}
		outputStream.end();
		console.log(`【${filename}】下载完成`);
		// 删除分片文件
	} catch (error) {
		console.error('下载失败:', error);
		// 将失败的信息写入到失败列表中
	}
}

fileList.forEach(async item=>{
	await downloadM3U8(item.name, item.url);
})

