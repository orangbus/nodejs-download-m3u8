const fs = require('fs');
const crypto = require('crypto');
const axios = require('axios');
const M3U8Parser = require('m3u8-parser');

// M3U8 视频的 URL
const m3u8Url = 'https://s.xlzys.com/play/rb2EZ0Pa/index.m3u8';

/**
 * 解密视频
 * @param methods
 * @param key
 * @param iv
 * @param segmentData
 * @returns {Buffer}
 */
function decryptSegment(methods,key, iv, segmentData) {
	const decipher = crypto.createDecipheriv(methods, key, iv);
	const decryptedData = Buffer.concat([decipher.update(segmentData), decipher.final()]);
	return decryptedData;
}

async function downloadM3U8(url) {
	try {
		const response = await axios.get(url);

		const parser = new M3U8Parser.Parser();
		parser.push(response.data);
		parser.end();

		// 下载秘钥
		const keyBaseUrl = m3u8Url.substring(0,m3u8Url.lastIndexOf('/') + 1) + 'enc.key';

		const playlist = parser.manifest;

		const segments = playlist.segments;

		if (!fs.existsSync('output')) {
			fs.mkdirSync('output');
		}

		const downloadPromises = [];

		for (let i = 0; i < segments.length; i++) {
			const segmentUrl = segments[i].uri;
			downloadPromises.push(axios.get(segmentUrl, { responseType: 'arraybuffer' }));
		}

		const segmentResponses = await Promise.all(downloadPromises);

		// 下载并解密片段
		const keyContent = fs.readFileSync('output/enc.key');
		const key = Buffer.from(keyContent, 'hex');
		const ivHex = '00000000000000000000000000000000'; // 根据实际的 M3U8 文件中的 IV 参数获取
		const iv = Buffer.from(ivHex, 'hex');

		if (!fs.existsSync('pro')) {
			fs.mkdirSync('pro');
		}
		const outputFilename = 'pro/output.ts';
		const outputStream = fs.createWriteStream(outputFilename);

		for (let i = 0; i < segmentResponses.length; i++) {
			const segmentResponse = segmentResponses[i];
			const decryptedSegmentData = decryptSegment('aes-128-cbc', key, iv, segmentResponse.data);
			outputStream.write(decryptedSegmentData);
			console.log(`Downloaded and decrypted segment ${i}`);
		}

		outputStream.end();

		console.log('Download and decryption complete.');

	} catch (error) {
		console.error('Error:', error);
	}
}

downloadM3U8(m3u8Url);
