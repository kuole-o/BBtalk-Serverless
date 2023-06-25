const crypto = require('crypto');
const COS = require('cos-nodejs-sdk-v5');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const AV = require('leanengine');

const Tcb_SecretId = process.env.Tcb_SecretId;
const Tcb_SecretKey = process.env.Tcb_SecretKey;

const TopDomain = process.env.TopDomain; //顶级域名，如 media.guole.fun 中的 "fun"
const SecondLevelDomain = process.env.SecondLevelDomain; //二级域名，如 media.guole.fun 中的 "guole"
const SubDomain = process.env.SubDomain; //主子域，如 media.guole.fun 中的 "media"

const TcbCOS = new COS({
  SecretId: Tcb_SecretId,
  SecretKey: Tcb_SecretKey,
});

var access_token = ''
var token_expire_time = 0 // 保存 token 过期时间戳
var cache = {}; // 定义一个缓存对象

async function getUserConfig(FromUserName) {
  if (!cache[FromUserName]) { // 如果缓存中没有对应的结果，则发起查询请求
    try {
      const userConfig = new AV.Query('UserBindingStatus');
      userConfig.equalTo('userId', FromUserName);
      let result = await userConfig.first();
      if (result && result.get('isBinding')) {
        cache[FromUserName] = result; // 将查询结果增量保存到本地缓存中
        console.log(`[INFO] cache：缓存 ${FromUserName} 的绑定查询结果`)
      }
    } catch (err) {
      console.error(err);
      if (err.response) {
        replyMsg = `HTTP Error: ${err.response.status}\n` + `Error Message: JSON.stringify(${err.response.data})`
      } else {
        replyMsg = '验证绑定状态时发生未知错误，请稍后再试！';
      }
    }
  } else { // 如果缓存中有对应的结果，则判断查询结果中的 userId 是否与本地缓存里的 FromUserName 相同，若不同则重新发起查询请求
    if (cache[FromUserName].get('userId') !== FromUserName) {
      try {
        const userConfig = new AV.Query('UserBindingStatus');
        userConfig.equalTo('userId', FromUserName);
        let result = await userConfig.first();

        if (result && result.get('isBinding')) {
          cache[FromUserName] = result; // 更新缓存
          console.log(`[INFO] cache：更新 ${FromUserName} 的绑定查询结果`)
        }

      } catch (err) {
        console.error(err);
        if (err.response) {
          replyMsg = `HTTP Error: ${err.response.status}\n` + `Error Message: JSON.stringify(${err.response.data})`
        } else {
          replyMsg = '验证绑定状态时发生未知错误，请稍后再试！';
        }
      }
    }
    console.log(`[INFO] cache：从缓存中返回 ${FromUserName} 的绑定状态`)
  }
  return cache[FromUserName]; // 返回缓存中的结果
}

function generateSignature(token, timestamp, nonce, msg) {
  const sha1 = crypto.createHash('sha1').update([token, timestamp, nonce, msg].sort().join(''), 'binary').digest('hex');
  return sha1;
}

function encryptMsg(msg, token, encodingAesKey, appId) {
  const randomStr = crypto.randomBytes(16).toString('hex');
  const text = Buffer.from(msg).toString('base64');

  // 构建 AES 加密算法所需的初始化向量（iv）
  const iv = Buffer.from(encodingAesKey + '=', 'base64').slice(0, 16);

  // 使用 AES-CBC 加密算法进行加密
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(encodingAesKey + '=', 'base64'), iv);
  let encrypted = cipher.update(text, 'binary', 'base64');
  encrypted += cipher.final('base64');

  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = Math.random().toString().slice(2, 12);

  // 构建加密后的 XML 消息
  const encryptedXml = `<xml>
      <ToUserName><![CDATA[${appId}]]></ToUserName>
      <FromUserName><![CDATA[${token}]]></FromUserName>
      <CreateTime>${timestamp}</CreateTime>
      <MsgType><![CDATA[text]]></MsgType>
      <Content><![CDATA[${msg}]]></Content>
      <Encrypt><![CDATA[${encrypted}]]></Encrypt>
      <MsgSignature><![CDATA[${generateSignature(token, timestamp, nonce, encrypted)}]]></MsgSignature>
      <Nonce><![CDATA[${nonce}]]></Nonce>
    </xml>`;
  //console.log('[INFO] 加密后的 encryptedXml 为：' + encryptedXml)
  return encryptedXml;
}

function encryptedXml(replyMsg, FromUserName, ToUserName, token, encodingAesKey, appId) {
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = Math.random().toString().slice(2, 12);
  const msg = replyMsg;
  const encryptedMsg = encryptMsg(msg, token, encodingAesKey, appId);
  const msgSignature = generateSignature(token, timestamp, nonce, encryptedMsg);
  const encryptedXml = `<xml>
      <ToUserName><![CDATA[${FromUserName}]]></ToUserName>
      <FromUserName><![CDATA[${ToUserName}]]></FromUserName>
      <CreateTime>${timestamp}</CreateTime>
      <MsgType><![CDATA[text]]></MsgType>
      <Content><![CDATA[${msg}]]></Content>
      <Encrypt><![CDATA[${encryptedMsg}]]></Encrypt>
      <MsgSignature><![CDATA[${generateSignature(token, timestamp, nonce, msg)}]]></MsgSignature>
      <Nonce><![CDATA[${nonce}]]></Nonce>
      </xml>`;
  console.log('[INFO] 加密后的 encryptedXml 为：' + encryptedXml)
  // 最终响应结果
  return encryptedXml
}

async function getAccessToken(appId, appSecret) {
  // 判断本地存储的 token 是否过期
  if (Date.now() > token_expire_time) {
    // token 已过期，重新获取
    try {
      const res = await axios.get(`https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${appId}&secret=${appSecret}`)
      access_token = res.data.access_token
      token_expire_time = Date.now() + 7000 * 1000 // 更新 token 过期时间戳
    } catch (err) {
      console.log(err);
      throw new Error('获取 access_token 出错！');
    }
  }
  return access_token
}

//获取微信临时素材后缀
async function getWechatMediaFileSuffix(wechat_access_token, mediaId) {
  try {
    const response = await axios.get(`https://api.weixin.qq.com/cgi-bin/media/get?access_token=${wechat_access_token}&media_id=${mediaId}`);
    const contentType = response.headers['content-type'];
    let fileSuffix = '';
    switch (true) {
      case contentType === 'image/jpeg':
        fileSuffix = 'jpg';
        break;
      case contentType === 'image/png':
        fileSuffix = 'png';
        break;
      case contentType === 'image/webp':
        fileSuffix = 'webp';
        break;
      case contentType === 'image/gif':
        fileSuffix = 'gif';
        break;
      case contentType === 'audio/amr':
        fileSuffix = 'amr';
        break;
      case contentType === 'audio/speex':
        fileSuffix = 'speex';
        break;
      case contentType === 'video/mp4' || contentType === 'video/mpeg4':
        fileSuffix = 'mp4';
        break;
      case contentType === 'image/gif':
        fileSuffix = 'gif';
        break;
    }
    return fileSuffix;
  } catch (error) {
    console.log(error);
    throw new Error('获取微信临时素材后缀！');
  }
}

//下载微信临时素材
async function downloadMediaToTmp(mediaUrl, mediaId, fileSuffix) {
  try {
    const response = await axios({
      method: 'GET',
      url: mediaUrl,
      responseType: 'stream'
    });

    // 下载至 tmp 临时空间
    const ws = fs.createWriteStream('/tmp/' + mediaId + '.' + fileSuffix, { autoClose: true });
    response.data.pipe(ws);

    return new Promise((resolve, reject) => {
      ws.on('finish', async () => {
        console.log('[INFO] 下载临时素材成功！');
        resolve();
      });
      ws.on('error', (err) => {
        console.log(err);
        reject('下载临时素材失败！');
      });
    });
  } catch (err) {
    console.log(err);
    throw new Error('下载临时素材失败！');
  }
}

// 上传图片文件到腾讯云cos的指定存储桶的指定路径下
async function uploadMediaToCos(bucket, mediaId, region, cosPath, fileSuffix) {
  return new Promise((resolve, reject) => {
    const fileStream = fs.createReadStream('/tmp/' + mediaId + '.' + fileSuffix);
    const fileName = new Date().getTime() + '.' + fileSuffix;
    const tmpFilePath = '/tmp/' + mediaId + '.' + fileSuffix;
    TcbCOS.sliceUploadFile({
      Bucket: bucket,
      Region: region,
      Key: cosPath + fileName, //上传的文件在 COS 存储桶中的路径和文件名，如 images/avatar.png
      FilePath: tmpFilePath,
      Body: fileStream,
    }, (err, data, tmpFilePath) => {
      if (err) {
        reject(err);
      } else {
        const url = `https://${SubDomain}.${SecondLevelDomain}.${TopDomain}${cosPath}${fileName}`;
        resolve(url);
        console.log('[INFO] 上传至腾讯云存储桶成功！URL 为：' + `https://${bucket}.cos.${region}.myqcloud.com${cosPath}${fileName}`)
        //deleteFolderRecursive(FilePath)
        if (fs.existsSync(tmpFilePath)) {
          fs.unlink(tmpFilePath, (err) => {
            if (err) {
              console.error(err);
            } else {
              console.log(`[INFO] 删除临时素材成功：${tmpFilePath}`);
            }
          });
        } else {
          console.log(`[INFO] 文件不存在：${tmpFilePath}`);
        }
      }
    });
  });
};

async function uploadImageQubu(mediaId, fileSuffix) {
  try {
    const formData = new FormData()
    formData.append('image', fs.createReadStream(`/tmp/${mediaId}.${fileSuffix}`))

    const response = await axios({
      method: 'post',
      url: 'https://7bu.top/api/upload',
      data: formData,
      headers: {
        'Content-Type': `multipart/form-data; boundary=${formData._boundary}`
      }
    })

    console.log('[INFO] 上传至去不图床成功！', response.data.data.url)
    //deleteFolderRecursive('/tmp')
    const tmpFilePath = `/tmp/${mediaId}.${fileSuffix}`;
    if (fs.existsSync(tmpFilePath)) {
      fs.unlink(tmpFilePath, (err) => {
        if (err) {
          console.error(err);
        } else {
          console.log(`[INFO] 删除临时素材成功：${tmpFilePath}`);
        }
      });
    } else {
      console.log(`[INFO] 文件不存在：${tmpFilePath}`);
    }
    return response.data.data.url
  } catch (error) {
    throw new Error(error)
  }
}

//删除临时文件
function deleteFolderRecursive(url) {
  var files = [];
  //判断给定的路径是否存在
  if (fs.existsSync(url)) {
    //返回文件和子目录的数组
    files = fs.readdirSync(url);
    files.forEach(function (file, index) {
      // var curPath = url + "/" + file;
      var curPath = path.join(url, file);
      //fs.statSync同步读取文件夹文件，如果是文件夹，在重复触发函数
      if (fs.statSync(curPath).isDirectory()) { // recurse
        deleteFolderRecursive(curPath);
        // 是文件delete file  
      } else {
        fs.unlinkSync(curPath);
      }
    });
    //清除文件夹
    console.log('[INFO] 删除成功：' + url);
  } else {
    console.log("[INFO] 给定的路径不存在，请给出正确的路径");
  }
};

function gaodeMap(zoom,alt,altLan,altLat){
  let mapWidth = '100%';
  let mapHeight = '360px';
  let gaode_txt = "高德地图";
  let mapid = 'gaodeMap-' + altLan + '-' + altLat;
  let dom = '', script = '';
  dom += '<div class="map-box">';
  dom += '<div id="' + mapid + '"' + ' style="max-width:' + mapWidth + '; height:' + mapHeight + ';display: block;margin:0 auto;z-index:1;border-radius: 5px;"></div>';
  dom += '</div>';
  script += "var normalm=L.tileLayer.chinaProvider('GaoDe.Normal.Map',{maxZoom:20,minZoom:1,attribution:'" + gaode_txt + "'});";
  script += "var imgm=L.tileLayer.chinaProvider('GaoDe.Satellite.Map',{maxZoom:20,minZoom:1,attribution:'" + gaode_txt + "'});";
  script += "var imga=L.tileLayer.chinaProvider('GaoDe.Satellite.Annotion',{maxZoom:20,minZoom:1,attribution:'" + gaode_txt + "'});";
  script += 'var normal=L.layerGroup([normalm]),image=L.layerGroup([imgm,imga]);';
  script += 'var baseLayers={"高德地图":normal,"高德卫星地图":imgm,"高德卫星标注":image};';
  script += "var mymap=L.map('" + mapid + "',{center:[" + altLat + "," + altLan + "],zoom:" + zoom + ",layers:[normal],zoomControl:false});";
  script += "L.control.layers(baseLayers,null).addTo(mymap);L.control.zoom({zoomInTitle:'放大',zoomOutTitle:'缩小'}).addTo(mymap);";
  script += "var marker = L.marker(['" + altLat + "','" + altLan + "']).addTo(mymap);";
  if (alt) {
    script += 'marker.bindPopup("' + alt + '").openPopup();';
  }
  return { dom, script };
};

module.exports = {
  access_token,
  token_expire_time,
  cache,
  getUserConfig,
  generateSignature,
  encryptMsg,
  encryptedXml,
  getAccessToken,
  getWechatMediaFileSuffix,
  downloadMediaToTmp,
  uploadMediaToCos,
  uploadImageQubu,
  deleteFolderRecursive,
  gaodeMap
};