const xml2js = require('xml2js');
const crypto = require('crypto');
const tools = require('./tools'); // 引入工具类方法
const { handleCommand, newbbTalk } = require('./handleCommand'); // 引入处理指令的逻辑

const PageSize = process.env.PageSize || 10;
const Tcb_Bucket = process.env.Tcb_Bucket;
const Tcb_Region = process.env.Tcb_Region;

const Tcb_JsonPath = process.env.Tcb_JsonPath;
const Tcb_ImagePath = process.env.Tcb_ImagePath;
const Tcb_MediaPath = process.env.Tcb_MediaPath;

const token = process.env.WeChat_Token;
const encodingAesKey = process.env.WeChat_encodingAesKey;
const appId = process.env.WeChat_appId; //微信公众平台 appId
const appSecret = process.env.WeChat_appSecret; //微信公众平台 appSecret
const Upload_Media_Method = process.env.Upload_Media_Method || 'cos'; // 导入上传媒体的方式，环境变量配置可选值：cos - 腾讯云存储桶；qubu - 去不图床；使用发视频功能，必须选择 cos 方式；

async function handleGetRequest(event) {
    const { requestContext, headers, body, pathParameters, queryStringParameters, headerParameters, path, queryString, httpMethod } = event;

    // 验证请求是否来自微信服务器
    const { signature, timestamp, nonce, echostr } = event.queryString;
    const tmpStr = crypto.createHash('sha1').update([token, timestamp, nonce].sort().join('')).digest('hex'); // 计算 SHA1 哈希值
    if (!signature || !timestamp || !nonce || !echostr) {
        let response = { statusCode: 400 }
        if (requestContext) response.requestContext = requestContext
        if (headers) response.headers = headers
        if (body) response.body = body
        if (pathParameters) response.pathParameters = pathParameters
        if (queryStringParameters) response.queryStringParameters = queryStringParameters
        if (headerParameters) response.headerParameters = headerParameters
        if (path) response.path = path
        if (queryString) response.queryString = queryString
        if (httpMethod) response.httpMethod = httpMethod
        console.log(response)
        return response;
    }
    if (tmpStr === signature) {
        console.log(event)
        return echostr
    } else {
        let response = { statusCode: 401 }
        if (requestContext) response.requestContext = requestContext
        if (headers) response.headers = headers
        if (body) response.body = body
        if (pathParameters) response.pathParameters = pathParameters
        if (queryStringParameters) response.queryStringParameters = queryStringParameters
        if (headerParameters) response.headerParameters = headerParameters
        if (path) response.path = path
        if (queryString) response.queryString = queryString
        if (httpMethod) response.httpMethod = httpMethod
        console.log(response)
        return response;
    }
}

async function handlePostRequest(event, lastMsgId, pageNum) {
    const { requestContext, headers, body, pathParameters, queryStringParameters, headerParameters, path, queryString, httpMethod } = event;
    //console.log('[INFO] 请求 event 为：')
    //console.log(event)
    const parser = new xml2js.Parser({ explicitArray: false, ignoreAttrs: true });
    const xmlStr = await parser.parseStringPromise(body.toString());
    const { ToUserName, FromUserName, CreateTime, MsgType, MediaId, Content, MsgId, PicUrl, Format, ThumbMediaId, Location_X, Location_Y, Scale, Label, Title, Description, Url } = xmlStr.xml || {};
    if (ToUserName) console.log('[INFO] 请求 ToUserName 为：' + ToUserName);
    if (FromUserName) console.log('[INFO] 请求 FromUserName 为：' + FromUserName);
    if (CreateTime) console.log('[INFO] 请求 CreateTime 为：' + CreateTime);
    if (MsgType) console.log('[INFO] 请求 MsgType 为：' + MsgType);
    if (MediaId) console.log('[INFO] 请求 MediaId 为：' + MediaId);
    if (Content) console.log('[INFO] 请求 Content 为：' + Content);
    if (lastMsgId) console.log('[INFO] 请求 lastMsgId 为：' + lastMsgId);
    if (MsgId) console.log('[INFO] 请求 MsgId 为：' + MsgId);
    if (PicUrl) console.log('[INFO] 请求 PicUrl 为：' + PicUrl);
    if (Format) console.log('[INFO] 请求 Format (语音格式)为：' + Format);
    if (ThumbMediaId) console.log('[INFO] 请求 ThumbMediaId (视频封面图 id)为：' + ThumbMediaId);
    if (Location_X) console.log('[INFO] 请求 Location_X (纬度)为：' + Location_X);
    if (Location_Y) console.log('[INFO] 请求 Location_Y (经度)为：' + Location_Y);
    if (Scale) console.log('[INFO] 请求 Scale (地图缩放大小)为：' + Scale);
    if (Label) console.log('[INFO] 请求 Label (地理位置信息)为：' + Label);
    if (Title) console.log('[INFO] 请求 Title 为：' + Title);
    if (Description) console.log('[INFO] 请求 Description 为：' + Description);
    if (Url) console.log('[INFO] 请求 Url 为：' + Url);

    var replyMsg = '';


    if (MsgId == lastMsgId) {
        replyMsg = 'success';
    } else {
        let startsWithSlash, matchCommand;
        if (Content !== undefined) {
            startsWithSlash = Content.match(/^\/.*/);
            matchCommand = Content.match(/^\/[a-z]+\s*(\d+)?|\/b\s*bb,/i);
        } else {
            startsWithSlash = '';
            matchCommand = '';
        }
        const isCommandRegex = /^\/.*/;
        let result, wechat_access_token, fileSuffix, videoUrl, text, mediaUrl;
        const mediaId = MediaId;
        if (MsgType === 'text') {
            try {
                // 匹配到指令内容
                if (startsWithSlash) {
                    let command = '';
                    let params = (Content.match(/^\/[a-z][\s\S]*?(\d+)?/i) || [])[1] || '';
                    if (matchCommand) {
                        command = matchCommand[0] || '';
                    }
                    if (params > PageSize) {
                        pageNum = Math.floor(params / PageSize) + 1;
                    }
                    console.log('[INFO] 1010 当前匹配到的 params 为：' + params)
                    console.log('[INFO] 1011 当前计算的 pageNum 为：' + pageNum)
                    switch (true) {
                        case command.includes('/h'):
                            command = '/h';
                            break;
                        case command.includes('/l'):
                            command = '/l';
                            break;
                        case command.includes('/e'):
                            command = '/e';
                            break;
                        case command.includes('/a'):
                            command = '/a';
                            break;
                        case command.includes('/f'):
                            command = '/f';
                            break;
                        case command.includes('/d'):
                            command = '/d';
                            break;
                        case command.includes('/s'):
                            command = '/s';
                            break;
                        case command.includes('/b'):
                            command = '/b';
                            break;
                        case command.includes('/nobb'):
                            command = '/nobb';
                            break;
                        case isCommandRegex.test(Content):
                            command = '/h';
                            break;
                        default:
                            break;
                    }
                    console.log('[INFO] 当前匹配到的 command 为：' + command)

                    if (command === '/h' || command.includes('bb') || command === '/b' || command === '/nobb') {
                        console.log('[INFO] 1001 调用 handleCommand 方法')
                        replyMsg = await handleCommand(command, params, Content, FromUserName);
                    } else {
                        result = await tools.getUserConfig(FromUserName);
                        if (result && result.get('isBinding')) {
                            if (command === '/l' || command === '/s' || command === '/d' || command === '/e' || command === '/a' || command === '/f') {
                                console.log('[INFO] 1002 调用 handleCommand 方法')
                                replyMsg = await handleCommand(command, params, Content, FromUserName);
                            } else {
                                replyMsg = '未知指令，请回复 /h 获取帮助';
                                console.log('[INFO] 5001 未知指令')
                            }
                        } else {
                            replyMsg = '回复以下命令绑定用户 /b bb,预置的环境变量 Binding_Key';
                            console.log('[INFO] 1003 回复以下命令绑定用户')
                        }
                    }
                } else {
                    result = await tools.getUserConfig(FromUserName);
                    if (result && result.get('isBinding')) {
                        replyMsg = await newbbTalk(Content, MsgType);
                        await tools.queryContentByPage(Tcb_Bucket, Tcb_Region, Tcb_JsonPath, pageNum, PageSize, true)
                    } else {
                        // 未绑定用户，回复绑定指令
                        replyMsg = '回复以下命令绑定用户 /b bb,预置的环境变量 Binding_Key';
                        console.log('[INFO] 1004 回复以下命令绑定用户');
                    }
                }
            } catch (err) {
                console.error(err);
                if (err.response) {
                    replyMsg = `HTTP Error: ${err.response.status}\n` + `Error Message: JSON.stringify(${err.response.data})`
                } else {
                    replyMsg = '查询绑定状态请求出错，请稍后再试！'
                }
            }
        } else if (MsgType === 'image') {
            try {
                result = await tools.getUserConfig(FromUserName);
                if (result && result.get('isBinding')) {
                    wechat_access_token = await tools.getAccessToken(appId, appSecret);
                    console.log('[INFO] 当前获取到的 Access Token 为：' + wechat_access_token)
                    fileSuffix = await tools.getWechatMediaFileSuffix(wechat_access_token, mediaId);
                    mediaUrl = 'https://api.weixin.qq.com/cgi-bin/media/get?access_token=' + wechat_access_token + '&media_id=' + mediaId;
                    await tools.downloadMediaToTmp(mediaUrl, mediaId, fileSuffix);
                    if (mediaUrl && mediaId && Upload_Media_Method === 'cos') {
                        imgURL = await tools.uploadMediaToCos(Tcb_Bucket, Tcb_Region, Tcb_ImagePath, mediaId, fileSuffix);
                        text = `<img src="${imgURL}">`;
                        replyMsg = await newbbTalk(imgURL, MsgType);
                        await tools.queryContentByPage(Tcb_Bucket, Tcb_Region, Tcb_JsonPath, pageNum, PageSize, true)
                    } else if (mediaUrl && mediaId && Upload_Media_Method === 'qubu') {
                        imgURL = await tools.uploadImageQubu(mediaId, fileSuffix);
                        //text = `<img src="${imgURL}">`;
                        replyMsg = await newbbTalk(imgURL, MsgType);
                        await tools.queryContentByPage(Tcb_Bucket, Tcb_Region, Tcb_JsonPath, pageNum, PageSize, true)
                    } else {
                        replyMsg = '云函数上传图片方式配置有误！可选 cos - 腾讯云存储桶；qubu - 去不图床';
                    }
                } else {
                    replyMsg = '回复以下命令绑定用户 /b bb,预置的环境变量 Binding_Key';
                    console.log('[INFO] 1005 回复以下命令绑定用户')
                }
            } catch (err) {
                console.error(err);
                if (err.response) {
                    replyMsg = `HTTP Error: ${err.response.status}\n` + `Error Message: JSON.stringify(${err.response.data})`
                } else {
                    replyMsg = '查询绑定状态请求出错，请稍后再试！'
                }
            }
        } else if (MsgType === 'voice') {
            // try {
            //     result = await tools.getUserConfig(FromUserName);
            //     if (result && result.get('isBinding')) {
            //         wechat_access_token = await tools.getAccessToken(appId, appSecret);
            //         console.log('[INFO] 当前获取到的 Access Token 为：' + wechat_access_token)
            //         fileSuffix = await tools.getWechatMediaFileSuffix(wechat_access_token, mediaId);
            //         mediaUrl = 'https://api.weixin.qq.com/cgi-bin/media/get?access_token=' + wechat_access_token + '&media_id=' + mediaId;
            //         if (fileSuffix === 'amr') {
            //             // 下载文件并转换为 MP3 格式
            //             await tools.downloadMediaToTmp(mediaUrl, mediaId, fileSuffix);
            //             console.log('[INFO] 音频文件已成功转换为 MP3 格式并保存到指定路径！');
            //             if (mediaUrl && mediaId && Upload_Media_Method === 'cos') {
            //                 const voiceUrl = await tools.uploadMediaToCos(Tcb_Bucket, Tcb_Region, Tcb_MediaPath, mediaId, fileSuffix);
            //                 replyMsg = await newbbTalk(voiceUrl, MsgType);
            //                 await tools.queryContentByPage(Tcb_Bucket, Tcb_Region, Tcb_JsonPath, pageNum, PageSize, true)
            //             } else {
            //                 replyMsg = '云函数上传方式配置有误！音频消息仅支持上传方式为 cos 时处理';
            //             }
            //         } else {
            //             replyMsg = '抱歉，暂不支持微信 speex 高清音频发布哔哔功能';
            //         }
            //     } else {
            //         replyMsg = '回复以下命令绑定用户 /b bb,预置的环境变量 Binding_Key';
            //         console.log('[INFO] 1006 回复以下命令绑定用户')
            //     }
            // } catch (err) {
            //     console.error(err);
            //     if (err.response) {
            //         replyMsg = `HTTP Error: ${err.response.status}\n` + `Error Message: JSON.stringify(${err.response.data})`
            //     } else {
            //         replyMsg = '查询绑定状态请求出错，请稍后再试！'
            //     }
            // }
            replyMsg = '抱歉，暂不支持哔哔发布微信语音！';
        } else if (MsgType === 'video' || MsgType === 'shortvideo') {
            try {
                result = await tools.getUserConfig(FromUserName);
                if (result && result.get('isBinding')) {
                    wechat_access_token = await tools.getAccessToken(appId, appSecret);
                    console.log('[INFO] 当前获取到的 Access Token 为：' + wechat_access_token)
                    fileSuffix = await tools.getWechatMediaFileSuffix(wechat_access_token, mediaId);
                    mediaUrl = 'https://api.weixin.qq.com/cgi-bin/media/get?access_token=' + wechat_access_token + '&media_id=' + mediaId;
                    await tools.downloadMediaToTmp(mediaUrl, mediaId, fileSuffix);
                    if (mediaUrl && mediaId && Upload_Media_Method === 'cos') {
                        videoUrl = await tools.uploadMediaToCos(Tcb_Bucket, Tcb_Region, Tcb_MediaPath, mediaId, fileSuffix);
                        //text = `<video src="${videoUrl}" controls></video>`;
                        replyMsg = await newbbTalk(videoUrl, MsgType);
                        await tools.queryContentByPage(Tcb_Bucket, Tcb_Region, Tcb_JsonPath, pageNum, PageSize, true)
                    } else {
                        replyMsg = '云函数上传方式配置有误！视频消息仅支持上传方式为 cos 时处理';
                    }
                } else {
                    replyMsg = '回复以下命令绑定用户 /b bb,预置的环境变量 Binding_Key';
                    console.log('[INFO] 1007 回复以下命令绑定用户')
                }
            } catch (err) {
                console.error(err);
                if (err.response) {
                    replyMsg = `HTTP Error: ${err.response.status}\n` + `Error Message: JSON.stringify(${err.response.data})`
                } else {
                    replyMsg = '查询绑定状态请求出错，请稍后再试！'
                }
            }
        } else if (MsgType === 'location') {
            try {
                result = await tools.getUserConfig(FromUserName);
                if (result && result.get('isBinding')) {
                    let { dom, script } = tools.gaodeMap(Scale, Label, Location_Y, Location_X)
                    console.log(dom)
                    console.log(script)
                    dom = dom.replace(/\s+/g, ' ').trim();
                    replyMsg = await newbbTalk(dom, MsgType, script);
                    await tools.queryContentByPage(Tcb_Bucket, Tcb_Region, Tcb_JsonPath, pageNum, PageSize, true)
                } else {
                    replyMsg = '回复以下命令绑定用户 /b bb,预置的环境变量 Binding_Key';
                    console.log('[INFO] 1008 回复以下命令绑定用户')
                }
            } catch (err) {
                console.error(err);
                if (err.response) {
                    replyMsg = `HTTP Error: ${err.response.status}\n` + `Error Message: JSON.stringify(${err.response.data})`
                } else {
                    replyMsg = '查询绑定状态请求出错，请稍后再试！'
                }
            }
        } else if (MsgType === 'link') {
            try {
                result = await tools.getUserConfig(FromUserName);
                if (result && result.get('isBinding')) {
                    if (!Description) Description = Url;
                    text = `
                            <a class="bbtalk-url" id="bbtalk-url" href="${Url}" title='${Title}' description='${Description}' rel="noopener noreferrer" target="_blank">
                                <div class="bbtalk-url-info">
                                    <i class="fa-fw fa-solid fa-link"></i>
                                </div>
                                <div class="bbtalk-url-title">${Title}</div>
                                <div class="bbtalk-url-desc">${Description}</div>
                            </a>
                            `;
                    text = text.replace(/\s+/g, ' ').trim();
                    replyMsg = await newbbTalk(text, MsgType);
                    await tools.queryContentByPage(Tcb_Bucket, Tcb_Region, Tcb_JsonPath, pageNum, PageSize, true)
                } else {
                    replyMsg = '回复以下命令绑定用户 /b bb,预置的环境变量 Binding_Key';
                    console.log('[INFO] 1009 回复以下命令绑定用户')
                }
            } catch (err) {
                console.error(err);
                if (err.response) {
                    replyMsg = `HTTP Error: ${err.response.status}\n` + `Error Message: JSON.stringify(${err.response.data})`
                } else {
                    replyMsg = '查询绑定状态请求出错，请稍后再试！'
                }
            }
        } else {
            replyMsg = '暂不支持此类型消息';
        }
    }

    // 超出微信允许最大长度截断，避免出现异常响应
    const endingWord = '……';
    const replyMsgByteLength = Buffer.byteLength(replyMsg, 'utf8')
    const maxByteLength = 2047 - Buffer.byteLength(endingWord, 'utf8');
    if (replyMsgByteLength > maxByteLength) {
        const slicedMsg = tools.sliceByByte(replyMsg, maxByteLength);
        replyMsg = slicedMsg + endingWord;
    }
    console.log('[INFO] replyMsgByteLength 为：' + replyMsgByteLength);
    console.log('[INFO] maxByteLength 为：' + maxByteLength);

    const response = tools.encryptedXml(replyMsg, FromUserName, ToUserName, token, encodingAesKey, appId)
    lastMsgId = MsgId;
    return response
}

module.exports = {
    handleGetRequest,
    handlePostRequest
};