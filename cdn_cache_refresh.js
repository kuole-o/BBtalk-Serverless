'use strict';
const Tcb_SecretId = process.env.Tcb_SecretId;
const Tcb_SecretKey = process.env.Tcb_SecretKey;
const token = process.env.token;
const wecomWebHook = process.env.WeComWebHook;
const tencentcloud = require("tencentcloud-sdk-nodejs");
const axios = require('axios');
const moment = require('moment');
const CdnClient = tencentcloud.cdn.v20180606.Client;

let lastTriggerTime = {}; // 全局变量，用于存储上一次触发的时间戳
const delayTime = 1 * 60 * 1000; // 1分钟的毫秒数

const clientConfig = {
  credential: {
    secretId: Tcb_SecretId,
    secretKey: Tcb_SecretKey,
  },
  profile: {
    signMethod: "TC3-HMAC-SHA256",
    httpProfile: {
      reqMethod: "POST",
      reqTimeout: 30,
      endpoint: "cdn.tencentcloudapi.com",
    },
  },
};

async function postWeComRobotMsg(content) {
  if (!content) return '没有消息要发送';
  const postData = {
    "msgtype": "text",
    "text": {
      content: content
    },
    "mentioned_list": ["@all"]
  };
  return axios.post(wecomWebHook, postData)
    .then(function (res) {
      console.log(res.data);
      return res.data;
    })
    .catch(function (error) {
      console.log(error);
      return 'st wrong when post qywx robot api';
    })
    .then(function (result) {
      return '发送企业微信机器人成功:' + JSON.stringify(result) + 'H:' + moment().utcOffset(8).format('kk');
    });
}

// 实例化要请求产品的client对象,clientProfile是可选的
const client = new CdnClient(clientConfig);

exports.main_handler = async (event, context) => {
  const { requestContext, headers, body, pathParameters, queryStringParameters, headerParameters, path, queryString, httpMethod, MsgId } = event;

  // 简单鉴权
  const request_token =
    (headers && headers.token) ||
    (queryString && queryString.token) ||
    (event && event.token) ||
    "";
  if (request_token !== token) return {
    "isBase64Encoded": false,
    "statusCode": 401,
    "headers": { "Content-Type": "text/plain; charset=utf-8" },
    "body": "Unauthorized",
  }

  // 处理函数定时激活
  const isScfActivation = (queryString && queryString.auto) || (event && event.auto) || false;
  if (isScfActivation) {
    return {
      "isBase64Encoded": false,
      "statusCode": 200,
      "headers": { "Content-Type": "text/plain; charset=utf-8" },
      "body": "Success 触发云函数成功！"
    }
  }

  try {
    const pathsUrl = queryString.url;
    const currentTime = Date.now(); // 获取当前时间戳

    let content, code;
    let pathsToRefresh = [];

    console.log(queryString);

    pathsToRefresh = [pathsUrl];

    // 检查是否距离上一次触发已经过去了 1 分钟
    if (currentTime - lastTriggerTime[pathsUrl] < delayTime) {
      console.log("距离上次触发未满足 1 分钟，不执行刷新逻辑：", pathsUrl);
      code = 204;
      content = `距离上次触发未满足 1 分钟，不执行刷新逻辑：${pathsUrl}`;
      await postWeComRobotMsg(content);
      return {
        "isBase64Encoded": false,
        "statusCode": code,
        "headers": { "Content-Type": "text/html; charset=utf-8" },
        "body": content,
      };
    }

    if (!pathsUrl) {
      code = 204;
      content = "CDN 刷新失败！请检查 url 参数以正确调用";
      await postWeComRobotMsg(content);
      return {
        "isBase64Encoded": false,
        "statusCode": code,
        "headers": { "Content-Type": "text/html; charset=utf-8" },
        "body": content,
      };
    }

    console.log("pathsToRefresh：", pathsToRefresh);

    const params = {
      "Paths": pathsToRefresh,
      "FlushType": "flush"
    };

    const data = await client.PurgePathCache(params);
    console.log(data);

    lastTriggerTime[pathsUrl] = currentTime;

    code = 200;
    content = `刷新 CDN 成功：${pathsToRefresh}`;

    await postWeComRobotMsg(content);

    return {
      "isBase64Encoded": false,
      "statusCode": code,
      "headers": { "Content-Type": "text/html; charset=utf-8" },
      "body": content,
    };
  } catch (err) {
    console.error("Error:", err);
    return {
      "isBase64Encoded": false,
      "statusCode": 500,
      "headers": { "Content-Type": "text/html; charset=utf-8" },
      "body": `处理 CDN 刷新请求时出现错误：${err.message}`,
    };
  }
};
