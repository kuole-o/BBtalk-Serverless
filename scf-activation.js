'use strict';
const Tcb_SecretId = process.env.Tcb_SecretId;
const Tcb_SecretKey = process.env.Tcb_SecretKey;
const token = process.env.token;
const wecomWebHook = process.env.WeComWebHook;
const tencentcloud = require("tencentcloud-sdk-nodejs");
const axios = require('axios');
const moment = require('moment');
const ScfClient = tencentcloud.scf.v20180416.Client;

const clientConfig = {
  credential: {
    secretId: Tcb_SecretId,
    secretKey: Tcb_SecretKey,
  },
  region: "ap-hongkong",
  profile: {
    httpProfile: {
      endpoint: "scf.tencentcloudapi.com",
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
const client = new ScfClient(clientConfig);

exports.main_handler = async (event, context) => {
  try {
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

    const scfName = ["bbtalk-wechat", "upload-bbtalk-cos", "ssl-update-1684589326", "cdn_cache_refresh"];
    const invokePromises = scfName.map(async (name) => {
      const params = {
        "FunctionName": name, // 云函数名称
        "ClientContext": `{\"auto\":1,\"token\":\"${token}\"}`,
        "Namespace": "default",
      };

      try {
        const data = await client.Invoke(params);
        console.log(data);
        console.log(`运行云函数成功：${name}`);

        if (data && data.Response && data.Response.Result && data.Response.Result.ErrMsg !== '') {
          console.log(`运行云函数失败：${name};\nErrMsg：${data.Response.Result.ErrMsg}`);
          await postWeComRobotMsg(`运行云函数失败：${name}; ErrMsg：${data.Response.Result.ErrMsg}`);
          return { success: false };
        }
        return { success: true };
      } catch (error) {
        console.error(`运行云函数失败：${name};\nErrMsg：${error.message}`);
        await postWeComRobotMsg(`运行云函数失败：${name}; ErrMsg：${error.message}`);
        return { success: false, error: error.message };
      }
    });

    const results = await Promise.all(invokePromises);

    const isSuccess = results.every((result) => result.success);

    if (isSuccess) {
      return {
        "isBase64Encoded": false,
        "statusCode": 200,
        "headers": { "Content-Type": "text/html; charset=utf-8" },
        "body": JSON.stringify({
          code: 200,
          message: "所有云函数运行成功！"
        })
      };
    } else {
      return {
        "isBase64Encoded": false,
        "statusCode": 500,
        "headers": { "Content-Type": "text/html; charset=utf-8" },
        "body": JSON.stringify({
          code: 500,
          message: "某个云函数运行失败！"
        })
      };
    }
  } catch (err) {
    console.error("Error:", err);
    return {
      "isBase64Encoded": false,
      "statusCode": 500,
      "headers": { "Content-Type": "text/html; charset=utf-8" },
      "body": JSON.stringify({
        code: 500,
        message: `运行云函数失败：${err.message}`
      })
    };
  }
};