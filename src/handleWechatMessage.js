const xml2js = require('xml2js');
const crypto = require('crypto');
const tools = require('./tools');
const { handleCommand, newbbTalk } = require('./handleCommand');
const { createLogger } = require('./utils/logger');
const config = require('./config');
const logger = createLogger('WechatMessage');

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
    Upload_Media_Method,
    MessageProcessing: {
        CacheExpireTime,
        CleanupInterval
    }
} = config;

// 消息ID缓存 - 使用 Map 存储消息ID和时间戳
const messageCache = new Map();
// 使用配置中的值
const CACHE_CLEANUP_INTERVAL = CleanupInterval;
const MESSAGE_EXPIRE_TIME = CacheExpireTime;

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
async function handlePostRequest(event, pageNum) {
    const startTime = Date.now();
    try {
        const xmlStr = await parseXmlBody(event.body);
        if (!xmlStr?.xml) {
            logger.error('解析XML失败');
            return createResponse(400);
        }

        const messageData = xmlStr.xml;
        logMessageInfo(messageData);

        // 同步处理事件消息
        if (messageData.MsgType === 'event') {
            let replyMsg;
            if (messageData.Event === 'subscribe') {
                replyMsg = '👋 欢迎关注哔哔闪念！\n\n👀 关于我\n<a href="https://guole.fun/">我的主页</a>  |  <a href="https://blog.guole.fun/">我的博客</a>  |  <a href="https://blog.guole.fun/bb">哔哔闪念</a>\n\n⚙️ 实用工具\n<a href="https://blog.guole.fun/">每日热搜</a>  |  <a href="https://unlock-music.guole.fun/">解锁音乐</a>\n\n<a href="https://music.guole.fun/">听我想听</a>  |  <a href="https://game.guole.fun/">怀旧小游戏</a>\n\n👉️ <a href="https://blog.guole.fun/posts/17745/">点击此处</a>查阅哔哔闪念搭建方法。';
            } else if (messageData.Event === 'unsubscribe') {
                replyMsg = '🛀🏼 您已取消关注，期待下次再见！';
            }

            if (replyMsg) {
                return tools.encryptedXml(
                    replyMsg,
                    messageData.FromUserName,
                    messageData.ToUserName,
                    token,
                    encodingAesKey,
                    appId
                );
            }
            return 'success';
        }

        // 同步处理 /h 命令
        if (messageData.MsgType === 'text' && (messageData.Content === '/h' || messageData.Content === '/help')) {
            const helpMsg = await handleCommand('/h', null, null, messageData.FromUserName);
            return tools.encryptedXml(
                helpMsg,
                messageData.FromUserName,
                messageData.ToUserName,
                token,
                encodingAesKey,
                appId
            );
        }

        // 处理其他消息
        if (messageData.MsgId) {
            // 检查消息是否重复
            if (isMessageDuplicate(messageData.MsgId)) {
                const status = tools.getProcessingStatus('message', messageData.MsgId);
                if (status?.done) {
                    // 如果处理完成，返回结果
                    return tools.encryptedXml(
                        status.result,
                        messageData.FromUserName,
                        messageData.ToUserName,
                        token,
                        encodingAesKey,
                        appId
                    );
                }

                // 如果是第三次重试且即将超时，返回处理中的提示
                if (status?.retries >= 3 && Date.now() - status.timestamp > 4000) {
                    return tools.encryptedXml(
                        '⏳ 操作超时，请稍后检查结果或重试',
                        messageData.FromUserName,
                        messageData.ToUserName,
                        token,
                        encodingAesKey,
                        appId
                    );
                }

                // 继续等待处理完成
                try {
                    const startTime = Date.now();
                    const timeout = status?.retries >= 3 ? 4000 : 4900; // 第三次重试给更短的超时时间

                    while (!status?.done && Date.now() - startTime < timeout) {
                        await new Promise(resolve => setTimeout(resolve, 100));
                        const currentStatus = tools.getProcessingStatus('message', messageData.MsgId);
                        if (currentStatus?.done) {
                            return tools.encryptedXml(
                                currentStatus.result,
                                messageData.FromUserName,
                                messageData.ToUserName,
                                token,
                                encodingAesKey,
                                appId
                            );
                        }
                    }
                } catch (err) {
                    logger.error('等待处理完成时发生错误:', err);
                }
                // 超时不返回任何内容，让微信重试
                return;
            }

            // 首次处理消息
            cacheMessageId(messageData.MsgId);
            tools.setProcessingStatus('message', messageData.MsgId, { done: false });

            try {
                // 直接处理消息并等待结果
                const replyMsg = await processMessageAsync(messageData, pageNum);
                return tools.encryptedXml(
                    replyMsg,
                    messageData.FromUserName,
                    messageData.ToUserName,
                    token,
                    encodingAesKey,
                    appId
                );
            } catch (err) {
                logger.error('处理消息失败:', err);
                // 不返回任何内容，让微信重试
                return;
            }
        }

        return createResponse(400);
    } catch (err) {
        logger.error('处理POST请求失败:', err);
        logger.perf('处理微信消息失败', startTime);
        return;
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

// 异步处理所有类型的消息
async function processMessageAsync(messageData, pageNum) {
    const startTime = Date.now();
    try {
        const { MsgType, Content, FromUserName } = messageData;
        let replyMsg;

        // 检查用户绑定状态
        const userConfig = await tools.getUserConfig(FromUserName);
        if (!userConfig?.get('isBinding')) {
            if (Content?.startsWith('/b ')) {
                replyMsg = await handleCommand('/b', null, Content, FromUserName);
            } else {
                replyMsg = '❌️ 您未完成绑定，无法使用该指令。回复以下命令绑定用户：/b 环境变量Binding_Key';
            }
            tools.setProcessingStatus('message', messageData.MsgId, {
                done: true,
                result: replyMsg
            });
            return replyMsg;
        }

        // 处理文本消息
        if (MsgType === 'text') {
            const content = Content.trim();

            // 处理命令
            if (content.startsWith('/')) {
                // 1. 使用正则表达式匹配无空格命令格式
                const noSpaceCommandRegex = /^(\/[a-z])(\d+)(.*)$/i;
                const match = content.match(noSpaceCommandRegex);

                logger.info('命令匹配结果: {0}', match ? JSON.stringify({
                    fullMatch: match[0],
                    command: match[1],
                    number: match[2],
                    remaining: match[3]
                }) : 'null');

                if (match) {
                    const [, actualCommand, numStr, remainingContent] = match;
                    const actualParams = parseInt(numStr);

                    // 检查是否是支持的命令
                    if (['/l', '/a', '/f', '/s', '/e', '/d'].includes(actualCommand)) {
                        // 对于 /a、/f、/e 命令，需要处理后面的内容
                        if (['/a', '/f', '/e'].includes(actualCommand)) {
                            const contentPart = remainingContent.trim();
                            if (!contentPart) {
                                replyMsg = `❌️ 无效的指令，请输入 "${actualCommand} ${actualParams} 内容"`;
                            } else {
                                replyMsg = await handleCommand(actualCommand, actualParams, content, FromUserName);
                            }
                        } else {
                            // 其他命令直接处理
                            replyMsg = await handleCommand(actualCommand, actualParams, content, FromUserName);
                        }
                        tools.setProcessingStatus('message', messageData.MsgId, {
                            done: true,
                            result: replyMsg
                        });
                        return replyMsg;
                    }
                }

                // 2. 处理正常的空格分隔命令格式
                const spaceCommandRegex = /^(\/[a-z])\s+(\d+)(?:\s+(.*))?$/i;
                const spaceMatch = content.match(spaceCommandRegex);

                if (spaceMatch) {
                    const [, command, numStr, remainingContent] = spaceMatch;
                    const params = parseInt(numStr);

                    // 对于需要内容的命令，检查内容是否存在
                    if (['/a', '/f', '/e'].includes(command) && !remainingContent) {
                        replyMsg = `❌️ 无效的指令，请输入 "${command} ${params} 内容"`;
                    } else {
                        replyMsg = await handleCommand(command, params, content, FromUserName);
                    }
                } else {
                    // 3. 处理不带参数的命令 (如 /h, /nobb)
                    const [command, ...params] = content.split(/\s+/);
                    replyMsg = await handleCommand(command, params[0], content, FromUserName);
                }
            } else {
                // 处理普通文本消息
                replyMsg = await newbbTalk(content, 'text');
                await tools.queryContentByPage(Tcb_Bucket, Tcb_Region, Tcb_JsonPath, pageNum, PageSize, true);
            }
        } else {
            // 处理其他类型消息
            switch (MsgType) {
                case 'image':
                    replyMsg = await handleImageMessage(messageData, pageNum);
                    break;

                case 'voice':
                    replyMsg = await handleVoiceMessage(messageData, pageNum);
                    break;

                case 'video':
                case 'shortvideo':
                    replyMsg = await handleVideoMessage(messageData, pageNum);
                    break;

                case 'location':
                    replyMsg = await handleLocationMessage(messageData, pageNum);
                    break;

                case 'link':
                    replyMsg = await handleLinkMessage(messageData, pageNum);
                    break;

                default:
                    replyMsg = '❌️ 不支持的消息类型';
                    break;
            }
        }

        tools.setProcessingStatus('message', messageData.MsgId, {
            done: true,
            result: replyMsg
        });

        logger.perf(`处理${MsgType}类型消息完成`, startTime);
        return replyMsg;
    } catch (err) {
        logger.error('异步消息失败:', err);
        const errorMsg = tools.handleError(err);
        tools.setProcessingStatus('message', messageData.MsgId, {
            done: true,
            result: errorMsg
        });
        logger.perf(`处理${messageData.MsgType}类型消息失败`, startTime);
        throw err;
    }
}

// 处理图片消息
async function handleImageMessage(messageData, pageNum) {
    const startTime = Date.now();
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
        return '❌️ 云函数上传方式配置有误！';
    } catch (err) {
        logger.error('处理图片消息失败:', err);
        logger.perf('处理图片消息失败', startTime);
        return tools.handleError(err);
    }
}

// 处理语音消息
async function handleVoiceMessage(messageData, pageNum) {
    try {
        if (Upload_Media_Method !== 'cos') {
            return '❌️ 云函数上传方式配置有误！语音消息仅支持上传方式为 cos 时处理';
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
            return '❌️ 云函数上传方式配置有误！视频消息仅支持上传方式为 cos 时处理';
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
        const replyMsg = await newbbTalk(videoUrl, 'video');
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

module.exports = {
    handleGetRequest,
    handlePostRequest
};