const AV = require('leanengine');
const { handleGetRequest, handlePostRequest } = require('./handleWechatMessage');
const { createLogger } = require('./utils/logger');

const logger = createLogger('App');

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
AV.Cloud.useMasterKey(); // 全局开启 Master Key

exports.main_handler = async (event, context) => {
    const { requestContext, headers, body, pathParameters, queryStringParameters, headerParameters, path, queryString, httpMethod } = event;
    let content_text, response;

    const request_token = headers?.token || queryString?.token || event?.token || "";
    const isScfActivation = queryString?.auto || event?.auto || false;

    if (isScfActivation) {
        if (request_token === token) {
            return {
                isBase64Encoded: false,
                statusCode: 200,
                headers: { "Content-Type": "text/plain; charset=utf-8" },
                body: "Success 触发云函数成功！"
            };
        } else {
            return {
                isBase64Encoded: false,
                statusCode: 401,
                headers: { "Content-Type": "text/plain; charset=utf-8" },
                body: "Unauthorized",
            };
        }
    }

    try {
        if (httpMethod === 'GET' && queryString) {
            content_text = await handleGetRequest(event);
        } else if (httpMethod === 'POST' && body) {
            const pageNum = 1; // 可以根据需要传递或修改
            content_text = await handlePostRequest(event, null, pageNum);
        }

        response = {
            isBase64Encoded: false,
            statusCode: 200,
            headers: { "Content-Type": "text/plain" },
            body: content_text
        };
        return response;
    } catch (err) {
        logger.error('处理消息失败:', err);
        return {
            isBase64Encoded: false,
            statusCode: 500,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
            body: "Internal Server Error"
        };
    }
}