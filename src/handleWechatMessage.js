const xml2js = require('xml2js');
const crypto = require('crypto');
const AV = require('leanengine');
const tools = require('./tools');
const { handleCommand, newbbTalk } = require('./handleCommand');
const { createLogger } = require('./utils/logger');
const config = require('./config');

const logger = createLogger('WechatMessage');

// 消息ID缓存 - 使用 Map 存储消息ID和时间戳
const messageCache = new Map();
// 缓存清理间隔 (5分钟)
const CACHE_CLEANUP_INTERVAL = 5 * 60 * 1000;
// 消息缓存过期时间 (1分钟)
const MESSAGE_EXPIRE_TIME = 60 * 1000;

// 定期清理过期的消息缓存
setInterval(() => {
    const now = Date.now();
    for (const [msgId, timestamp] of messageCache) {
        if (now - timestamp > MESSAGE_EXPIRE_TIME) {
            messageCache.delete(msgId);
            logger.debug('清理过期消息ID: {0}', msgId);
        }
    }
}, CACHE_CLEANUP_INTERVAL);

// 从配置中获取环境变量
const {
    PageSize,
    Tcb: {
        Bucket: Tcb_Bucket,
        Region: Tcb_Region,
        JsonPath: Tcb_JsonPath,
        ImagePath: Tcb_ImagePath,
        MediaPath: Tcb_MediaPath
    },
    WeChat: {
        token,
        encodingAesKey,
        appId,
        appSecret
    },
    Upload_Media_Method
} = config;

// 处理 GET 请求 - 微信服务器认证
async function handleGetRequest(event) {
    try {
    const { signature, timestamp, nonce, echostr } = event.queryString;

        // 验证必要参数
    if (!signature || !timestamp || !nonce || !echostr) {
            logger.warn('缺少必要的验证参数');
            return createResponse(400);
        }

        // 验证签名
        const tmpStr = crypto.createHash('sha1')
            .update([token, timestamp, nonce].sort().join(''))
            .digest('hex');

        if (tmpStr !== signature) {
            logger.warn('签名验证失败');
            return createResponse(401);
        }

        logger.info('微信服务器验证成功');
        return echostr;
    } catch (err) {
        logger.error('处理GET请求失败:', err);
        return createResponse(500);
    }
}

// 处理 POST 请求 - 接收微信消息
async function handlePostRequest(event, lastMsgId, pageNum) {
    try {
        const xmlStr = await parseXmlBody(event.body);
        if (!xmlStr?.xml) {
            logger.error('解析XML失败');
            return createResponse(400);
        }

        const messageData = xmlStr.xml;
        logMessageInfo(messageData);

        // 处理事件消息
        if (messageData.MsgType === 'event') {
            const replyMsg = await processMessage(messageData, pageNum);
            return tools.encryptedXml(
                replyMsg,
                messageData.FromUserName,
                messageData.ToUserName,
                token,
                encodingAesKey,
                appId
            );
        }

        // 检查消息是否重复 (仅对非事件消息)
        if (isMessageDuplicate(messageData.MsgId)) {
            logger.info('重复消息，已跳过处理: {0}', messageData.MsgId);
            return 'success';
        }

        // 记录消息ID (仅对非事件消息)
        if (messageData.MsgId) {
            cacheMessageId(messageData.MsgId);
        }

        // 对于媒体消息，先生成回复，然后异步处理上传
        if (['image', 'video', 'voice'].includes(messageData.MsgType)) {
            // 生成回复消息
            let replyMsg;
            switch (messageData.MsgType) {
                case 'image':
                    replyMsg = '图片发送成功，正在上传处理...';
                    break;
                case 'voice':
                    replyMsg = '语音发送成功，正在上传处理...';
                    break;
                case 'video':
                    replyMsg = '视频发送成功，正在上传处理...';
                    break;
            }

            // 异步处理媒体文件
            processMediaAsync(messageData, pageNum).catch(err => {
                logger.error('异步处理媒体文件失败:', err);
            });

            // 立即返回回复消息
            return tools.encryptedXml(
                replyMsg,
                messageData.FromUserName,
                messageData.ToUserName,
                token,
                encodingAesKey,
                appId
            );
        }

        // 其他消息同步处理
        const replyMsg = await processMessage(messageData, pageNum);
        return tools.encryptedXml(
            replyMsg,
            messageData.FromUserName,
            messageData.ToUserName,
            token,
            encodingAesKey,
            appId
        );
    } catch (err) {
        logger.error('处理POST请求失败:', err);
        return createResponse(500);
    }
}

// 检查消息是否重复
function isMessageDuplicate(msgId) {
    return messageCache.has(msgId);
}

// 缓存消息ID
function cacheMessageId(msgId) {
    messageCache.set(msgId, Date.now());
    logger.debug('缓存消息ID: {0}', msgId);
}

// 解析XML消息体
async function parseXmlBody(body) {
    try {
        const parser = new xml2js.Parser({
            explicitArray: false,
            ignoreAttrs: true
        });
        return await parser.parseStringPromise(body.toString());
    } catch (err) {
        logger.error('解析XML消息体失败:', err);
        throw err;
    }
}

// 记录消息信息
function logMessageInfo(messageData) {
    const logFields = [
        'ToUserName', 'FromUserName', 'CreateTime', 'MsgType',
        'MediaId', 'Content', 'MsgId', 'PicUrl', 'Format',
        'ThumbMediaId', 'Location_X', 'Location_Y', 'Scale',
        'Label', 'Title', 'Description', 'Url'
    ];

    logFields.forEach(field => {
        if (messageData[field]) {
            logger.info(`${field}: ${messageData[field]}`);
        }
    });
}

// 处理不同类型的消息
async function processMessage(messageData, pageNum) {
    try {
        const { MsgType, Event, Content, FromUserName } = messageData;

        // 处理关注事件
        if (MsgType === 'event') {
            if (Event === 'subscribe') {
                return '欢迎关注哔哔闪念！\n\n 了解哔哔闪念搭建方法，请查阅： https://blog.guole.fun/posts/17745/';
            } else if (Event === 'unsubscribe') {
                return '您已取消关注，期待下次再见！';
            } else {    
                return 'success';
            }
        }

        // 处理不需要绑定的命令 - /h、/nobb、/b
        if (MsgType === 'text') {
            if (Content === '/h') {
                return await handleCommand('/h', null, null, FromUserName);
            }
            if (Content === '/nobb') {
                return await handleCommand('/nobb', null, null, FromUserName);
            }
            if (Content.startsWith('/b ')) {
                return await handleCommand('/b', null, Content, FromUserName);
            }
        }

        // 检查用户绑定状态 - 其他命令需要检查绑定状态
        const userConfig = await tools.getUserConfig(FromUserName);
        if (!userConfig?.get('isBinding')) {
            return '您未完成绑定，无法使用该指令。回复以下命令绑定用户：/b 环境变量Binding_Key';
        }

        // 处理其他指令消息
        if (MsgType === 'text' && Content.startsWith('/')) {
            const [command, ...params] = Content.split(/\s+/);
            return await handleCommand(command, params[0], Content, FromUserName);
        }

        // 处理其他类型消息
        switch (MsgType) {
            case 'text':
                return await newbbTalk(Content, MsgType);

            case 'image':
                return await handleImageMessage(messageData, pageNum);

            case 'voice':
                return await handleVoiceMessage(messageData, pageNum);

            case 'video':
            case 'shortvideo':
                return await handleVideoMessage(messageData, pageNum);

            case 'location':
                return await handleLocationMessage(messageData, pageNum);

            case 'link':
                return await handleLinkMessage(messageData, pageNum);

            default:
                return '暂不支持该类型消息';
                }
            } catch (err) {
        logger.error('处理消息失败:', err);
        return tools.handleError(err);
    }
}

// 处理图片消息
async function handleImageMessage(messageData, pageNum) {
    try {
        if (Upload_Media_Method === 'cos') {
            const access_token = await tools.getAccessToken(config.WeChat.appId, config.WeChat.appSecret);
            const fileSuffix = await tools.getWechatMediaFileSuffix(access_token, messageData.MediaId);

            const imageUrl = await tools.uploadMediaToCos(
                Tcb_Bucket,
                Tcb_Region,
                Tcb_ImagePath,
                messageData.MediaId,
                fileSuffix
            );
            // 直接使用URL作为内容
            const replyMsg = await newbbTalk(imageUrl, 'image');
            await tools.queryContentByPage(Tcb_Bucket, Tcb_Region, Tcb_JsonPath, pageNum, PageSize, true);
            return replyMsg;
        } else if (Upload_Media_Method === 'qubu') {
            const access_token = await tools.getAccessToken(config.WeChat.appId, config.WeChat.appSecret);
            const fileSuffix = await tools.getWechatMediaFileSuffix(access_token, messageData.MediaId);

            const imageUrl = await tools.uploadImageQubu(messageData.MediaId, fileSuffix);
            // 直接使用URL作为内容
            const replyMsg = await newbbTalk(imageUrl, 'image');
            await tools.queryContentByPage(Tcb_Bucket, Tcb_Region, Tcb_JsonPath, pageNum, PageSize, true);
            return replyMsg;
        }
        return '云函数上传方式配置有误！';
            } catch (err) {
        logger.error('处理图片消息失败:', err);
        return tools.handleError(err);
    }
}

// 处理语音消息
async function handleVoiceMessage(messageData, pageNum) {
    try {
        if (Upload_Media_Method !== 'cos') {
            return '云函数上传方式配置有误！语音消息仅支持上传方式为 cos 时处理';
        }

        const access_token = await tools.getAccessToken(config.WeChat.appId, config.WeChat.appSecret);
        const fileSuffix = await tools.getWechatMediaFileSuffix(access_token, messageData.MediaId);

        const voiceUrl = await tools.uploadMediaToCos(
            Tcb_Bucket,
            Tcb_Region,
            Tcb_MediaPath,
            messageData.MediaId,
            fileSuffix
        );
        // 直接使用URL作为内容
        const replyMsg = await newbbTalk(voiceUrl, 'voice');
        await tools.queryContentByPage(Tcb_Bucket, Tcb_Region, Tcb_JsonPath, pageNum, PageSize, true);
        return replyMsg;
            } catch (err) {
        logger.error('处理语音消息失败:', err);
        return tools.handleError(err);
    }
}

// 处理视频消息
async function handleVideoMessage(messageData, pageNum) {
    try {
        if (Upload_Media_Method !== 'cos') {
            return '云函数上传方式配置有误！视频消息仅支持上传方式为 cos 时处理';
        }

        const access_token = await tools.getAccessToken(config.WeChat.appId, config.WeChat.appSecret);
        const fileSuffix = await tools.getWechatMediaFileSuffix(access_token, messageData.MediaId);

        const videoUrl = await tools.uploadMediaToCos(
            Tcb_Bucket,
            Tcb_Region,
            Tcb_MediaPath,
            messageData.MediaId,
            fileSuffix
        );
        // 直接使用URL作为内容
        const replyMsg = await newbbTalk(videoUrl, messageData.MsgType);
        await tools.queryContentByPage(Tcb_Bucket, Tcb_Region, Tcb_JsonPath, pageNum, PageSize, true);
        return replyMsg;
            } catch (err) {
        logger.error('处理视频消息失败:', err);
        return tools.handleError(err);
    }
}

// 处理位置消息
async function handleLocationMessage(messageData, pageNum) {
    const { Scale, Label, Location_Y, Location_X } = messageData;
    const { dom, script } = tools.gaodeMap(Scale, Label, Location_Y, Location_X);
    const content = dom.replace(/\s+/g, ' ').trim();
    const replyMsg = await newbbTalk(content, 'location', script);
    await tools.queryContentByPage(Tcb_Bucket, Tcb_Region, Tcb_JsonPath, pageNum, PageSize, true);
    return replyMsg;
}

// 处理链接消息
async function handleLinkMessage(messageData, pageNum) {
    const { Title, Description, Url } = messageData;
    const desc = Description || Url;
    const content = `
        <a class="bbtalk-url" id="bbtalk-url" href="${Url}" title='${Title}' description='${desc}' rel="noopener noreferrer" target="_blank">
                                <div class="bbtalk-url-info">
                                    <i class="fa-fw fa-solid fa-link"></i>
                                </div>
                                <div class="bbtalk-url-title">${Title}</div>
            <div class="bbtalk-url-desc">${desc}</div>
        </a>
    `.replace(/\s+/g, ' ').trim();

    const replyMsg = await newbbTalk(content, 'link');
    await tools.queryContentByPage(Tcb_Bucket, Tcb_Region, Tcb_JsonPath, pageNum, PageSize, true);
    return replyMsg;
}

// 创建统一的响应对象
function createResponse(statusCode, body = '') {
    return {
        isBase64Encoded: false,
        statusCode,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
        body: statusCode === 200 ? body : getStatusMessage(statusCode)
    };
}

// 获取状态码对应的消息
function getStatusMessage(statusCode) {
    const messages = {
        400: 'Bad Request',
        401: 'Unauthorized',
        500: 'Internal Server Error'
    };
    return messages[statusCode] || 'Unknown Error';
}

// 异步处理媒体文件
async function processMediaAsync(messageData, pageNum) {
    try {
        // 检查用户绑定状态
        const userConfig = await tools.getUserConfig(messageData.FromUserName);
        if (!userConfig?.get('isBinding')) {
            logger.warn('用户未绑定，跳过媒体处理');
            return;
        }

        // 处理媒体文件上传
        switch (messageData.MsgType) {
            case 'image':
                await handleImageMessage(messageData, pageNum);
                break;
            case 'voice':
                await handleVoiceMessage(messageData, pageNum);
                break;
            case 'video':
            case 'shortvideo':
                await handleVideoMessage(messageData, pageNum);
                break;
        }

        // 更新所有分页 JSON 文件
        await tools.queryContentByPage(Tcb_Bucket, Tcb_Region, Tcb_JsonPath, 1, PageSize, true);
        logger.info('媒体文件处理完成: {0}', messageData.MediaId);
    } catch (err) {
        logger.error('异步处理媒体文件失败:', err);
        logger.error(err);
    }
}

module.exports = {
    handleGetRequest,
    handlePostRequest
};