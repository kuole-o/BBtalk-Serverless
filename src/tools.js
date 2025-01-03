const crypto = require('crypto');
const config = require('./config');
const COS = require('cos-nodejs-sdk-v5');
const AV = require('leanengine');
const axios = require('axios');
const { createLogger } = require('./utils/logger');
const fs = require('fs');

const logger = createLogger('Tools');

// 初始化 COS 实例
const TcbCOS = new COS({
  SecretId: config.Tcb.SecretId,
  SecretKey: config.Tcb.SecretKey
});

const tools = {
  cache: {},
  access_token: '',
  token_expire_time: 0,

  // 错误处理
  handleError(err) {
    logger.error('操作失败:', err);
    if (err.response) {
      return `HTTP Error: ${err.response.status}\n` +
        `Error Message: ${JSON.stringify(err.response.data)}`;
    }
    return '操作发生未知错误，请稍后再试！';
  },

  // 生成回复消息
  generateReplyMsg(type, data, extra = '') {
    switch (type) {
      case 'list':
        const bbList = data.map((item, index) =>
          `${index + 1}. ${item.get('content')}`).join('\n');
        return `最近 ${data.length} 条哔哔内容如下：\n---------------\n${bbList}`;

      case 'search':
        if (data.length === 0) {
          return `「${extra}」没有匹配的结果`;
        }

        if (data.length <= 10) {
          const searchList = data
            .sort((a, b) => b.get('createdAt') - a.get('createdAt'))
            .map((item, index) => {
              const content = item.get('content');
              return `${index + 1}. ${content}`;
            })
            .join('\n');

          return `「${extra}」匹配到 ${data.length} 条结果，详情如下：\n---------------\n${searchList}`;
        } else {
          const searchList = data
            .sort((a, b) => b.get('createdAt') - a.get('createdAt'))
            .slice(0, 10)
            .map((item, index) => {
              const content = item.get('content');
              // 如果内容太长则截断
              const truncatedContent = content.length > 35 ?
                content.slice(0, 35) + '…' :
                content;
              return `${index + 1}. ${truncatedContent}`;
            })
            .join('\n');

          return `「${extra}」匹配到 ${data.length} 条结果，详情如下（仅展示前 10 条）：\n---------------\n${searchList}`;
        }

      default:
        return '';
    }
  },

  // 字节截取
  sliceByByte(str, maxLength) {
    const buf = Buffer.from(str);
    if (buf.length <= maxLength) {
      return str;
    }
    let slicePos = maxLength;
    while (slicePos > 0 && (buf[slicePos] & 0xc0) === 0x80) {
      slicePos--;
    }
    const newBuf = Buffer.alloc(slicePos);
    buf.copy(newBuf, 0, 0, slicePos);
    return newBuf.toString();
  },

  // 签名生成
  generateSignature(token, timestamp, nonce, msg) {
    const sha1 = crypto.createHash('sha1')
      .update([token, timestamp, nonce, msg].sort().join(''), 'binary')
      .digest('hex');
    return sha1;
  },

  // 消息加密
  encryptMsg(msg, token, encodingAesKey, appId) {
    const randomStr = crypto.randomBytes(16).toString('hex');
    const text = Buffer.from(msg).toString('base64');
    const iv = Buffer.from(encodingAesKey + '=', 'base64').slice(0, 16);
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(encodingAesKey + '=', 'base64'), iv);
    let encrypted = cipher.update(text, 'binary', 'base64');
    encrypted += cipher.final('base64');
    return encrypted;
  },

  // 生成加密XML
  encryptedXml(replyMsg, FromUserName, ToUserName, token, encodingAesKey, appId) {
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = Math.random().toString().slice(2, 12);
    const encryptedMsg = this.encryptMsg(replyMsg, token, encodingAesKey, appId);
    const msgSignature = this.generateSignature(token, timestamp, nonce, encryptedMsg);

    return `<xml>
            <ToUserName><![CDATA[${FromUserName}]]></ToUserName>
            <FromUserName><![CDATA[${ToUserName}]]></FromUserName>
            <CreateTime>${timestamp}</CreateTime>
            <MsgType><![CDATA[text]]></MsgType>
            <Content><![CDATA[${replyMsg}]]></Content>
            <Encrypt><![CDATA[${encryptedMsg}]]></Encrypt>
            <MsgSignature><![CDATA[${msgSignature}]]></MsgSignature>
            <Nonce><![CDATA[${nonce}]]></Nonce>
        </xml>`;
  },

  // 获取微信 access_token
  async getAccessToken(appId, appSecret) {
    if (Date.now() > this.token_expire_time) {
      try {
        const res = await axios.get(
          `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${appId}&secret=${appSecret}`
        );
        this.access_token = res.data.access_token;
        this.token_expire_time = Date.now() + 7000 * 1000;
      } catch (err) {
        logger.error('获取access_token失败:', err);
        throw new Error('获取 access_token 出错！');
      }
    }
    return this.access_token;
  },

  // 获取用户配置
  async getUserConfig(FromUserName) {
    try {
      // 如果缓存中没有,则查询数据库
      if (!this.cache[FromUserName]) {
        const userConfig = new AV.Query('UserBindingStatus');
        userConfig.equalTo('userId', FromUserName);
        const result = await userConfig.first();

        // 只有绑定状态为 true 的才缓存
        if (result && result.get('isBinding')) {
          this.cache[FromUserName] = result;
          logger.info('缓存用户配置: {0}', FromUserName);
        }
      }
      return this.cache[FromUserName];
    } catch (err) {
      logger.error('获取用户配置失败:', err);
      throw err;
    }
  },

  // 获取微信媒体文件后缀
  async getWechatMediaFileSuffix(access_token, mediaId) {
    try {
      const response = await axios.get(
        `https://api.weixin.qq.com/cgi-bin/media/get?access_token=${access_token}&media_id=${mediaId}`
      );
      const contentType = response.headers['content-type'];
      let fileSuffix = '';

      switch (contentType) {
        case 'image/jpeg':
          fileSuffix = 'jpg';
          break;
        case 'image/png':
          fileSuffix = 'png';
          break;
        case 'image/webp':
          fileSuffix = 'webp';
          break;
        case 'image/gif':
          fileSuffix = 'gif';
          break;
        case 'audio/amr':
          fileSuffix = 'amr';
          break;
        case 'audio/speex':
          fileSuffix = 'speex';
          break;
        case 'video/mp4':
        case 'video/mpeg4':
          fileSuffix = 'mp4';
          break;
        default:
          fileSuffix = 'tmp';
      }

      logger.debug('媒体文件类型: {0}, 后缀: {1}', contentType, fileSuffix);
      return fileSuffix;
    } catch (err) {
      logger.error('获取媒体文件后缀失败:', err);
      throw err;
    }
  },

  // 下载媒体文件
  async downloadMediaToTmp(mediaUrl, mediaId, fileSuffix) {
    try {
      const response = await axios({
        method: 'GET',
        url: mediaUrl,
        responseType: 'stream'
      });

      const tmpFilePath = `/tmp/${mediaId}.${fileSuffix}`;
      const writer = fs.createWriteStream(tmpFilePath);

      return new Promise((resolve, reject) => {
        response.data.pipe(writer);

        writer.on('finish', () => {
          logger.info('下载媒体文件成功: {0}', tmpFilePath);
          resolve(tmpFilePath);
        });

        writer.on('error', err => {
          logger.error('写入文件失败:', err);
          reject(err);
        });
      });
    } catch (err) {
      logger.error('下载媒体文件失败:', err);
      throw err;
    }
  },

  // 上传媒体文件到 COS
  async uploadMediaToCos(bucket, region, cosPath, mediaId, fileSuffix) {
    try {
      const access_token = await this.getAccessToken(config.WeChat.appId, config.WeChat.appSecret);
      const mediaUrl = `https://api.weixin.qq.com/cgi-bin/media/get?access_token=${access_token}&media_id=${mediaId}`;
      const tmpFilePath = await this.downloadMediaToTmp(mediaUrl, mediaId, fileSuffix);

      const fileName = `${mediaId}.${fileSuffix}`;
      const fileContent = fs.readFileSync(tmpFilePath);

      // 处理路径，确保没有重复的斜杠
      const cleanPath = cosPath.replace(/^\/+|\/+$/g, ''); // 移除开头和结尾的斜杠
      const key = `${cleanPath}/${fileName}`; // 使用单个斜杠连接

      return new Promise((resolve, reject) => {
        TcbCOS.putObject({
          Bucket: bucket,
          Region: region,
          Key: key,
          Body: fileContent,
        }, (err, data) => {
          // 删除临时文件
          if (fs.existsSync(tmpFilePath)) {
            fs.unlinkSync(tmpFilePath);
          }

          if (err) {
            logger.error('上传媒体文件失败:', err);
            reject(err);
          } else {
            // 同样处理 URL 路径
            const url = `https://${config.SubDomain}.${config.SecondLevelDomain}.${config.TopDomain}/${cleanPath}/${fileName}`;
            logger.info('媒体文件上传成功: {0}', url);
            resolve(url);
          }
        });
      });
    } catch (err) {
      logger.error('处理媒体文件失败:', err);
      throw err;
    }
  },

  // 上传图片到去不图床
  async uploadImageQubu(mediaId, fileSuffix) {
    try {
      const tmpFilePath = `/tmp/${mediaId}.${fileSuffix}`;
      const fileBuffer = fs.readFileSync(tmpFilePath);
      const boundary = '----WebKitFormBoundary' + Math.random().toString(16).substr(2);

      const payload = Buffer.concat([
        Buffer.from(
          '--' + boundary + '\r\n' +
          'Content-Disposition: form-data; name="image"; filename="' + mediaId + '.' + fileSuffix + '"\r\n' +
          'Content-Type: image/' + fileSuffix + '\r\n\r\n'
        ),
        fileBuffer,
        Buffer.from('\r\n--' + boundary + '--\r\n')
      ]);

      const response = await axios({
        method: 'post',
        url: 'https://7bu.top/api/upload',
        data: payload,
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': payload.length
        }
      });

      // 上传完成后删除临时文件
      if (fs.existsSync(tmpFilePath)) {
        fs.unlink(tmpFilePath, (err) => {
          if (err) logger.warn('删除临时文件失败:', err);
        });
      }

      logger.info('上传至去不图床成功: {0}', response.data.data.url);
      return response.data.data.url;
    } catch (err) {
      logger.error('上传图片到去不图床失败:', err);
      throw err;
    }
  },

  // 生成高德地图
  gaodeMap(zoom, alt, altLan, altLat) {
    const mapWidth = '100%';
    const mapHeight = '360px';
    const gaode_txt = "高德地图";
    const mapid = `gaodeMap-${altLan}-${altLat}`;

    const dom = `
            <div class="map-box">
                <div id="${mapid}" style="max-width:${mapWidth}; height:${mapHeight};display:block;margin:0 auto;z-index:1;border-radius:5px;"></div>
            </div>
        `;

    const script = `
            var normalm = L.tileLayer.chinaProvider('GaoDe.Normal.Map',{
                maxZoom: 20,
                minZoom: 1,
                attribution: '${gaode_txt}'
            });
            var imgm = L.tileLayer.chinaProvider('GaoDe.Satellite.Map',{
                maxZoom: 20,
                minZoom: 1,
                attribution: '${gaode_txt}'
            });
            var imga = L.tileLayer.chinaProvider('GaoDe.Satellite.Annotion',{
                maxZoom: 20,
                minZoom: 1,
                attribution: '${gaode_txt}'
            });
            var normal = L.layerGroup([normalm]);
            var image = L.layerGroup([imgm,imga]);
            var baseLayers = {
                "高德地图": normal,
                "高德卫星地图": imgm,
                "高德卫星标注": image
            };
            var mymap = L.map('${mapid}',{
                center: [${altLat},${altLan}],
                zoom: ${zoom},
                layers: [normal],
                zoomControl: false
            });
            L.control.layers(baseLayers,null).addTo(mymap);
            L.control.zoom({
                zoomInTitle:'放大',
                zoomOutTitle:'缩小'
            }).addTo(mymap);
            var marker = L.marker([${altLat},${altLan}]).addTo(mymap);
            ${alt ? `marker.bindPopup("${alt}").openPopup();` : ''}
        `;

    return { dom, script };
  },

  // 查询内容并生成JSON
  async queryContentByPage(bucket, region, cosPath, pageNum, pageSize, isRecursive = false) {
    logger.info('开始查询内容分页');
    const query = new AV.Query('content');
    query.descending('createdAt');
    let results = [];
    let count = 0;
    let skip = (pageNum - 1) * pageSize;
    let queryLimit = isRecursive ? 1000 : pageSize;

    try {
      logger.info('开始查询 LeanCloud 数据, 查询限制: {0}', queryLimit);

      // 先获取总数
      count = await query.count();
      logger.info('总数据量: {0}', count);

      // 如果是递归查询，获取所有数据
      if (isRecursive) {
        logger.info('开始递归查询所有数据');
        let currentSkip = 0;

        while (currentSkip < count) {
          query.limit(1000);
          query.skip(currentSkip);
          const data = await query.find();
          results.push(...data);
          currentSkip += data.length;
          logger.debug('已获取数据量: {0}', currentSkip);
        }
      } else {
        // 非递归查询，只获取当前页数据
        query.limit(pageSize);
        query.skip(skip);
        results = await query.find();
      }

      logger.info('查询完成, 获取数据量: {0}', results.length);
      const pageCount = Math.ceil(count / pageSize);
      logger.info('计算分页完成, 总页数: {0}', pageCount);

      // 如果是递归查询，生成所有页的JSON
      if (isRecursive) {
        logger.info('开始生成所有 JSON 文件');
        const promises = [];

        for (let i = 1; i <= pageCount; i++) {
          const startIndex = (i - 1) * pageSize;
          const endIndex = Math.min(i * pageSize, count);
          const pageResults = results.slice(startIndex, endIndex);
          promises.push(this.generateAndUploadJson(bucket, region, cosPath, i, pageResults, count));
        }

        await Promise.all(promises);
        logger.info('所有 JSON 文件上传完成');
      } else {
        // 非递归查询，只生成当前页JSON
        logger.info('生成单页 JSON 文件: bbtalk_page{0}.json', pageNum);
        await this.generateAndUploadJson(bucket, region, cosPath, pageNum, results, count);
      }
    } catch (err) {
      logger.error('查询内容分页失败:', err);
      throw err;
    }
  },

  // 生成并上传 JSON 文件
  async generateAndUploadJson(bucket, region, cosPath, pageNum, results, totalCount) {
    logger.debug('开始生成第 {0} 页 JSON 数据', pageNum);

    const formattedResults = results.map(result => ({
      MsgType: result.get('MsgType'),
      content: result.get('content'),
      other: result.get('MsgType') === 'music' ?
        JSON.parse(result.get('other')) :
        result.get('other'),
      from: result.get('from'),
      createdAt: result.get('createdAt'),
      updatedAt: result.get('updatedAt'),
      objectId: result.id
    }));

    const formattedData = {
      results: formattedResults,
      count: totalCount,
    };

    const fileName = `bbtalk_page${pageNum}.json`;

    return new Promise((resolve, reject) => {
      TcbCOS.putObject({
        Bucket: bucket,
        Region: region,
        Key: `${cosPath}/${fileName}`,
        Body: JSON.stringify(formattedData),
      }, (err, data) => {
        if (err) {
          logger.error('上传文件失败: {0}', err);
          reject(err);
        } else {
          logger.info('文件上传成功: {0}', fileName);
          logger.debug('上传响应:', data);
          resolve();
        }
      });
    });
  },

  // 提取媒体URL
  extractMediaUrl(content) {
    const urlRegex = /((http?s):\/\/[-A-Za-z0-9+&@#/%?=~_|!:,.;]+[-A-Za-z0-9+&@#/%=~_|])/g;
    const match = content.match(urlRegex)?.[0];
    if (!match) return null;

    const url = new URL(match);
    if (url.href.includes(`${config.SubDomain}.${config.SecondLevelDomain}.${config.TopDomain}${config.Tcb.ImagePath}`) ||
      url.href.includes(`${config.SubDomain}.${config.SecondLevelDomain}.${config.TopDomain}${config.Tcb.MediaPath}`)) {
      return url;
    }
    return null;
  },

  // 删除媒体文件
  async deleteMediaFile(url) {
    try {
      await TcbCOS.deleteObject({
        Bucket: config.Tcb.Bucket,
        Region: config.Tcb.Region,
        Key: url.pathname
      });
      logger.info('删除媒体文件成功: {0}', url.pathname);
    } catch (err) {
      logger.warn('删除媒体文件失败:', err);
    }
  },

  // 绑定用户
  async bindUser(userId) {
    const query = new AV.Query('UserBindingStatus');
    const result = await query.first();

    if (!result) {
      logger.info('新用户绑定: {0}', userId);
      const userBindingStatus = new (AV.Object.extend('UserBindingStatus'))();
      userBindingStatus.set('userId', userId);
      userBindingStatus.set('isBinding', true);
      await userBindingStatus.save();
    } else {
      logger.info('更新用户绑定状态: {0}', userId);
      result.set('isBinding', true);
      await result.save();
    }
  },

  // 解除用户绑定
  async unbindUser(userId) {
    try {
      const query = new AV.Query('UserBindingStatus');
      query.equalTo('userId', userId);
      const result = await query.first();

      if (!result) return false;

      // 先删除缓存,再删除数据库记录
      if (this.cache[userId]) {
        delete this.cache[userId];
        logger.info('清除用户缓存: {0}', userId);
      }

      await result.destroy();
      logger.info('解除用户绑定: {0}', userId);
      return true;
    } catch (err) {
      logger.error('解除绑定失败:', err);
      throw err;
    }
  }
};

module.exports = tools;