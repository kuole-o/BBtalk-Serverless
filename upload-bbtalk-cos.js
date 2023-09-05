const COS = require('cos-nodejs-sdk-v5');
const fs = require('fs');
const AV = require('leanengine');

const Binding_Key = process.env.Binding_Key;
const Tcb_SecretId = process.env.Tcb_SecretId;
const Tcb_SecretKey = process.env.Tcb_SecretKey;
const PageSize = process.env.PageSize || 12;
const bucket = process.env.Tcb_Bucket;
const region = process.env.Tcb_Region;
const cosPath = process.env.Tcb_JsonPath;
const pageNum = 1;

const LeanCloud_ID = process.env.LeanCloud_ID;
const LeanCloud_KEY = process.env.LeanCloud_KEY;
const LeanCloud_MasterKey = process.env.LeanCloud_MasterKey;

AV.init({
  appId: LeanCloud_ID,
  appKey: LeanCloud_KEY,
  masterKey: LeanCloud_MasterKey,
  serverURL: 'https://leancloud.guole.fun',
});
AV.debug.enable(); // 启用调试模式
//AV.debug.disable(); // 停用调试模式
AV.Cloud.useMasterKey(); // 全局开启 Master Key

// 腾讯云 COS 配置
const TcbCOS = new COS({
  SecretId: Tcb_SecretId,
  SecretKey: Tcb_SecretKey,
  FileParallelLimit: 3, // 控制文件上传并发数
  LogLevel: 'debug' // 设置日志级别为 DEBUG、INFO、WARN、ERROR 和 NONE
});

exports.main_handler = async (event, context) => {
  const { httpMethod, headers, queryString, body } = event;

  // 验证请求是否包含 Binding_Key
  const requestBindingKey = headers['binding-key'] || queryString['binding-key'] || '';
  const type = headers['type'] || queryString['type'] || 1;
  console.log("headers：", headers)
  console.log("requestBindingKey：", requestBindingKey)
  if (requestBindingKey !== Binding_Key) {
    return {
      "isBase64Encoded": false,
      "statusCode": 403,
      "headers": {"Content-Type":"text/html; charset=utf-8"},
      "body":  JSON.stringify({
        code: 403,
        message: '未经授权'
      })
    };
  }

  if (httpMethod !== 'POST' && httpMethod !== 'GET') {
    return {
      "isBase64Encoded": false,
      "statusCode": 405,
      "headers": {"Content-Type":"text/html; charset=utf-8"},
      "body": JSON.stringify({
        code: 405,
        message: '不支持的请求方式'
      })
    };
  }

  try {
    await queryContentByPage(bucket, region, cosPath, pageNum, PageSize, type);
    return {
      "isBase64Encoded": false,
      "statusCode": 200,
      "headers": {"Content-Type":"text/html; charset=utf-8"},
      "body": JSON.stringify({
        code: 200,
        message: "BBtalk 最新数据分页 JSON 上传成功！"
      })
    };
  } catch (error) {
    console.error('错误:', error);
    return {
      "isBase64Encoded": false,
      "statusCode": 500,
      "headers": {"Content-Type":"text/html; charset=utf-8"},
      "body": JSON.stringify({
        code: 405,
        message: error.message
      })
    };
  }
};

/**
 * 获取 LeanCloud 数据转换成 json 格式上传到腾讯云 COS，以便使用 CDN 提升哔哔闪念加载速度
 * 分页查询指定页数和每页条数的数据，并将查询结果转换成指定格式的 JSON 数据
 * @param {string} bucket - 腾讯云存储桶名称
 * @param {string} region - 存储桶所在地域
 * @param {string} cosPath - 存储桶中存储 JSON 文件的路径
 * @param {number} pageNum - 指定页数，从1开始
 * @param {number} pageSize - 每页条数
 * @param {boolean} isRecursive - 是否递归获取后续页数的数据
 * @returns {Promise<void>} - 返回一个Promise对象，resolve时表示所有JSON文件上传成功
 */
async function queryContentByPage(bucket, region, cosPath, pageNum, pageSize, isRecursive = false) {
  console.log('[INFO] 已进入 queryContent 方法！')
  const query = new AV.Query('content');
  query.descending('createdAt');
  let results = [];
  let count = 0;
  let skip = ((pageNum - 1) * pageSize);
  let queryLimit = 0;

  console.log('[INFO] 开始查询 LeanCloud 数据...')
  if (isRecursive) {
    queryLimit = 1000;
  } else {
    queryLimit = pageSize;
  }
  console.log('[INFO] 首次查询，最多查询 ' + queryLimit + ' 条数据！')
  query.skip(skip);
  query.limit(queryLimit);
  const [data, num] = await Promise.all([query.find(), query.count()]);
  results.push(...data);
  count += num;
  skip += data.length;
  // console.log('[INFO] 以下将开始打印 results 数组数据：', results);

  console.log('[INFO] 查询 LeanCloud 数据完成！')
  console.log('[INFO] LeanCloud 共 ' + count + ' 条数据，但本次最多取回 ' + queryLimit + ' 条数据写入！')

  const pageCount = Math.ceil(count / pageSize); // 总页数
  console.log('[INFO] 总条数计算分页，共 ' + pageCount + ' 页！')

  const promises = [];
  const shouldUpdateAll = (pageNum === 1 && isRecursive) || (pageNum > 1 && isRecursive && count % pageSize === 1);
  console.log('[INFO] 当前 isRecursive 状态为：' + isRecursive)
  console.log('[INFO] 当前 shouldUpdateAll 状态为：' + shouldUpdateAll)
  if (shouldUpdateAll) {
    console.log('[INFO] 开始递归查询 LeanCloud 数据...')
    query.limit(1000); // 一次最多查询 1000 条数据
    while (data.length === 1000) {
      query.skip(skip);
      const [subData, subNum] = await Promise.all([query.find(), query.count()]);
      results.push(...subData);
      console.log('[INFO] 将 subData 增量写入 results ')
      count += subNum;
      skip += subData.length;
      data = subData;
    }
    console.log('[INFO] 递归查询 LeanCloud 数据完成！')
    console.log('[INFO] 共查询到 ' + count + ' 条数据！')
    console.log('[INFO] 重新生成所有 JSON 文件...')
    for (let i = 1; i <= pageCount; i++) {
      const startIndex = (i - 1) * pageSize;
      const endIndex = Math.min(i * pageSize, count);
      const subResults = results.slice(startIndex, endIndex);
      const formattedResults = subResults.map(result => {
        const formattedResult = {};
        formattedResult.MsgType = result.get('MsgType');
        formattedResult.content = result.get('content');
        if (result.get('MsgType') === 'music') {
          formattedResult.other = JSON.parse(result.get('other'));
        } else {
          formattedResult.other = result.get('other');
        }
        formattedResult.from = result.get('from');
        formattedResult.createdAt = result.get('createdAt');
        formattedResult.updatedAt = result.get('updatedAt');
        formattedResult.objectId = result.id;
        return formattedResult;
      });
      const formattedData = {
        results: formattedResults,
        count: count,
      };
      const fileName = `bbtalk_page${i}.json`;
      console.log('[INFO] 生成 JSON 文件：' + fileName);
      const params = {
        Bucket: bucket,
        Region: region,
        Key: `${cosPath}/${fileName}`,
        Body: JSON.stringify(formattedData),
      };
      promises.push(new Promise((resolve, reject) => {
        TcbCOS.putObject(params, (err, data) => {
          if (err) {
            reject(err);
          } else {
            console.log('[INFO] 上传 JSON 文件成功：' + fileName);
            console.log(data);
            resolve();
          }
        });
      }));
    }
  } else {
    console.log('[INFO] 生成 JSON 文件：' + `bbtalk_page${pageNum}.json`);
    const startIndex = 0;
    const endIndex = pageSize;
    const subResults = results.slice(startIndex, endIndex);
    const formattedResults = subResults.map(result => {
      const formattedResult = {};
      formattedResult.MsgType = result.get('MsgType');
      formattedResult.content = result.get('content');
      if (result.get('MsgType') === 'music') {
        formattedResult.other = JSON.parse(result.get('other'));
      } else {
        formattedResult.other = result.get('other');
      }
      formattedResult.from = result.get('from');
      formattedResult.createdAt = result.get('createdAt');
      formattedResult.updatedAt = result.get('updatedAt');
      formattedResult.objectId = result.id;
      return formattedResult;
    });
    const formattedData = {
      results: formattedResults,
      count: count,
    };
    const fileName = `bbtalk_page${pageNum}.json`;
    const params = {
      Bucket: bucket,
      Region: region,
      Key: `${cosPath}/${fileName}`,
      Body: JSON.stringify(formattedData),
    };
    promises.push(new Promise((resolve, reject) => {
      TcbCOS.putObject(params, (err, data) => {
        if (err) {
          reject(err);
        } else {
          console.log('[INFO] 上传 JSON 文件成功：' + fileName);
          console.log(data);
          resolve();
        }
      });
    }));
  }

  await Promise.all(promises);
  console.log('[INFO] 所有 JSON 文件上传成功！');
}