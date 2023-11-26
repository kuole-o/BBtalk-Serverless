const AV = require('leanengine');
const { handleGetRequest, handlePostRequest } = require('./handleWechatMessage'); // 引入处理微信消息的逻辑

const LeanCloud_ID = process.env.LeanCloud_ID;
const LeanCloud_KEY = process.env.LeanCloud_KEY;
const LeanCloud_MasterKey = process.env.LeanCloud_MasterKey;
const token = process.env.token;

AV.init({
    appId: LeanCloud_ID,
    appKey: LeanCloud_KEY,
    masterKey: LeanCloud_MasterKey,
    serverURL: 'https://leancloud.guole.fun',
});
AV.debug.enable(); // 启用调试模式
//AV.debug.disable(); // 停用调试模式
AV.Cloud.useMasterKey(); // 全局开启 Master Key

exports.main_handler = async (event, context, callback) => {
    const { requestContext, headers, body, pathParameters, queryStringParameters, headerParameters, path, queryString, httpMethod, MsgId } = event;
    let content_text, response;

    var pageNum = 1;
    var lastMsgId = null; // 全局变量，标识是否已处理请求

    // 处理函数定时激活
    const request_token =
        (headers && headers.token) ||
        (queryString && queryString.token) ||
        (event && event.token) ||
        "";
    const isScfActivation = (queryString && queryString.auto) || (event && event.auto) || false;
    if (isScfActivation && request_token === token) {
        return {
            "isBase64Encoded": false,
            "statusCode": 200,
            "headers": { "Content-Type": "text/plain; charset=utf-8" },
            "body": "Success 触发云函数成功！"
        }
    } else if (isScfActivation && request_token !== token) {
        return {
            "isBase64Encoded": false,
            "statusCode": 401,
            "headers": { "Content-Type": "text/plain; charset=utf-8" },
            "body": "Unauthorized",
        }
    }

    // 处理微信验证请求
    if (httpMethod === 'GET' && queryString) {
        try {
            content_text = await handleGetRequest(event);
            response = {
                "isBase64Encoded": false,
                "statusCode": 200,
                "headers": { "Content-Type": "text/plain" },
                "body": content_text
            }
            return response
        } catch (err) {
            console.error(err)
        }
    } else if (httpMethod === 'POST' && body) {// 处理微信发来的消息
        try {
            content_text = await handlePostRequest(event, lastMsgId, pageNum);
            response = {
                "isBase64Encoded": false,
                "statusCode": 200,
                "headers": { "Content-Type": "text/plain" },
                "body": content_text
            }
            return response
        } catch (err) {
            console.error(err)
        }
    }
}