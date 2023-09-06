const AV = require('leanengine');
const tools = require('./tools'); // 引入工具类方法
const COS = require('cos-nodejs-sdk-v5');

const TopDomain = process.env.TopDomain; //顶级域名，如 media.guole.fun 中的 "fun"
const SecondLevelDomain = process.env.SecondLevelDomain; //二级域名，如 media.guole.fun 中的 "guole"
const SubDomain = process.env.SubDomain; //子域，如 media.guole.fun 中的 "media"

const PageSize = process.env.PageSize || 10;
const Tcb_Bucket = process.env.Tcb_Bucket;
const Tcb_Region = process.env.Tcb_Region;
const Tcb_JsonPath = process.env.Tcb_JsonPath;
const Tcb_ImagePath = process.env.Tcb_ImagePath;
const Tcb_MediaPath = process.env.Tcb_MediaPath;
const Tcb_SecretId = process.env.Tcb_SecretId;
const Tcb_SecretKey = process.env.Tcb_SecretKey;

const Binding_Key = process.env.Binding_Key;

const TcbCOS = new COS({
    SecretId: Tcb_SecretId,
    SecretKey: Tcb_SecretKey,
});

async function handleCommand(command, params, Content, FromUserName) {
    let replyMsg = '';
    let index = 0;
    let pageNum = 1;
    let limit, content, other, bbList, newContent, results, query, result, match, matches, object, userConfig, List, order, inputContent;
    if (params > PageSize) {
        pageNum = Math.floor(params / PageSize) + 1;
    }
    matches = Content.match(/^\/([afe]\d*)\s*(.*)$/);
    if (Array.isArray(matches) && matches.length > 1) {
        inputContent = matches[2].trim();
        console.log('[INFO] 1012 当前匹配到的 inputContent 为：' + inputContent)
    }
    console.log('[INFO] 当前匹配到的 matches 为：' , matches)
    if (params) {
        index = params - 1;
        console.log('[INFO] params 存在，index 值为 params - 1 = ' + index)
    } else {
        index = 0;
        console.log('[INFO] params 不存在，index 为默认值 0')
    }
    console.log('[INFO] 1013 当前匹配到的 params 为：' + params)
    console.log('[INFO] 1014 当前计算的 pageNum 为：' + pageNum)
    switch (true) {
        case command === '/h':
            replyMsg = '「哔哔秘笈」\n==================\n/l 查询最近 10 条哔哔\n/l 数字 - 查询最近前几条，如 /l3\n---------------\n/a 文字 - 最新一条原内容后追加文字\n/a 数字 文字 - 第几条原内容后追加文字，如 /a3 开心！\n---------------\n/f 文字 - 最新一条原内容前插入文字\n/f 数字 文字 - 第几条原内容前插入文字，如 /f3 开心！\n---------------\n/s 关键词 - 搜索内容\n---------------\n/d 数字 - 删除第几条，如 /d2\n---------------\n/e 文字 - 编辑替换第 1 条\n/e 数字 文字 - 编辑替换第几条，如 /e2 新内容\n---------------\n/nobber - 解除绑定';
            break;
        case command === '/l':
            limit = 10;
            if (params) {
                limit = params;
            } else {
                replyMsg = '无效的参数，请输入 /l 数字';
            }
            try {
                query = new AV.Query('content');
                query.limit(limit);
                query.descending('createdAt');
                results = await query.find();
                console.log('[INFO] 当前 results 为：', results);
                if (results.length > 0) {
                    bbList = results.map((item, index) => `${index + 1}. ${item.get('content')}`).join('\n');
                    content = `最近 ${limit} 条哔哔内容如下：\n---------------\n` + bbList
                    //console.log('[INFO] content 为：', content)
                    replyMsg = content || '暂无哔哔';
                } else {
                    replyMsg = '暂无哔哔';
                }
            } catch (err) {
                console.error(err);
                if (err.response) {
                    replyMsg = `HTTP Error: ${err.response.status}\n` + `Error Message: ${JSON.stringify(err.response.data)}`
                } else {
                    replyMsg = '获取哔哔内容发生未知错误，请稍后再试！';
                }
            }
            break;
        case command === '/s':
            match = Content.match(/^\/s\s*(.*)$/i);
            let searchContent = '';
            if (match) {
                searchContent = match[1];
            }
            if (searchContent) {
                try {
                    query = new AV.Query('content');
                    query.contains('content', searchContent);
                    query.descending('createdAt');
                    result = await query.find();
                    limit = result.length;
                    if (limit > 0 && limit <= 10) {
                        List = result
                            .sort((a, b) => b.get('createdAt') - a.get('createdAt')) // 按照 leancloud 中的排序进行排序
                            .map((result, index) => {
                                content = result.attributes.content;
                                List = index + 1; // 将查询结果的序号作为 bbList 中元素的序号
                                return { order: List + '. ' + content };
                            });
                        bbList = List.map((item) => item.order).join('\n');
                        content = `「${searchContent}」匹配到 ${limit} 条结果，详情如下：\n---------------\n${bbList}`;
                        replyMsg = content;
                    } else if (limit > 10) {
                        List = result
                            .sort((a, b) => b.get('createdAt') - a.get('createdAt')) // 按照 leancloud 中的排序进行排序
                            .slice(0, 10) // 只取前 10 条数据
                            .map((result, index) => {
                                content = result.attributes.content;
                                List = index + 1; // 将查询结果的序号作为 bbList 中元素的序号
                                const truncatedContent = content.length > 35 ? content.slice(0, 35) + '…' : content;
                                return { order: order + '. ' + truncatedContent };
                            });
                        bbList = List.map((item) => item.order).join('\n');
                        content = `「${searchContent}」匹配到 ${limit} 条结果，详情如下（仅展示前 10 条）：\n---------------\n${bbList}`;
                        replyMsg = content;
                    } else {
                        replyMsg = `「${searchContent}」没有匹配的结果`;
                    }
                } catch (err) {
                    console.error(err);
                    if (err.response) {
                        replyMsg = `HTTP Error: ${err.response.status}\n` + `Error Message: ${JSON.stringify(err.response.data)}`
                    } else {
                        replyMsg = '查询结果时发生未知错误，请稍后再试！';
                    }
                }
            } else {
                replyMsg = '无效的指令，请输入 /s 关键词查询，如 /s Hello, World!';
            }
            break;
        case command === '/d':
            if (params) {
                try {
                    index = params - 1;
                    query = new AV.Query('content');
                    query.descending('createdAt').limit(params);
                    results = await query.find();
                    if (results[index]) {
                        object = results[index];
                        content = object.get('content');
                        console.log('[INFO] content 为：' + content)

                        const urlRegex = /((http?s):\/\/[-A-Za-z0-9+&@#/%?=~_|!:,.;]+[-A-Za-z0-9+&@#/%=~_|])/g;

                        let contentUrl = content.match(urlRegex)[0];
                        contentUrl = new URL(contentUrl);

                        if (contentUrl.href.includes(`${SubDomain}.${SecondLevelDomain}.${TopDomain}${Tcb_ImagePath}` || `${SubDomain}.${SecondLevelDomain}.${TopDomain}${Tcb_MediaPath}`)) {
                            const filePath = contentUrl.pathname;
                            console.log('[INFO] filePath 为：' + filePath)
                            TcbCOS.deleteObject({
                                Bucket: Tcb_Bucket,
                                Region: Tcb_Region,
                                Key: filePath,
                            }, function (err, data) {
                                if (err) {
                                    console.log(err);
                                } else {
                                    console.log(data);
                                }
                            });
                        }
                        await object.destroy();
                        await tools.queryContentByPage(Tcb_Bucket, Tcb_Region, Tcb_JsonPath, pageNum, PageSize, true)
                        replyMsg = '删除成功';
                    } else {
                        replyMsg = '无效的序号';
                    }
                } catch (err) {
                    console.error(err);
                    if (err.response) {
                        replyMsg = `HTTP Error: ${err.response.status}\n` + `Error Message: ${JSON.stringify(err.response.data)}`
                    } else {
                        replyMsg = '删除内容时发生未知错误，请稍后再试！';
                    }
                }
            } else {
                replyMsg = '无效的参数，请输入 /d 数字以删除指定哔哔';
            }
            break;
        case command === '/a' || command === '/f':
            if (inputContent) {
                params = params || 1;
                try {
                    query = new AV.Query('content');
                    query.limit(params);
                    query.descending('createdAt');
                    results = await query.find();
                    if (results[index]) {
                        object = results[index];
                        content = object.get('content');
                        newContent = command === '/a' ? content + inputContent : inputContent + content;
                        object.set('content', newContent);
                        await object.save();
                        await tools.queryContentByPage(Tcb_Bucket, Tcb_Region, Tcb_JsonPath, pageNum, PageSize)
                        let forward_back = '追加';
                        if (command === '/a') {
                            newContent = content + inputContent;
                        } else {
                            newContent = inputContent + content;
                            forward_back = '插入';
                        }
                        replyMsg = `已${forward_back}文本到第 ${params} 条`
                    } else {
                        replyMsg = `无效的指令，请输入 “/a 内容”，追加内容到第 1 条；输入“/f 内容”，插入内容到第 1 条`;
                    }
                } catch (err) {
                    console.error(err);
                    if (err.response) {
                        replyMsg = `HTTP Error: ${err.response.status}\n` + `Error Message: ${JSON.stringify(err.response.data)}`
                    } else {
                        replyMsg = '查询目标 objectId 发生未知错误，请稍后再试！'
                    }
                }
            } else {
                replyMsg = '无效的指令，请输入 “/a 内容”，追加内容到第 1 条；输入“/f 内容”，插入内容到第 1 条';
                console.log('[INFO] 4002 无效的指令')
            }
            break;
        case command === '/e':
            newContent = inputContent
            console.log('[INFO] 1015 当前匹配到的 newContent 为：' + newContent)
            if (newContent) {
                params = params || 1;
                try {
                    query = new AV.Query('content');
                    query.descending('createdAt').limit(params);
                    results = await query.find();
                    if (results[index]) {
                        object = results[index];
                        object.set('content', newContent);
                        await object.save();
                        await tools.queryContentByPage(Tcb_Bucket, Tcb_Region, Tcb_JsonPath, pageNum, PageSize)
                        replyMsg = `已修改第 ${params} 条内容为：${inputContent}`;
                    } else {
                        replyMsg = '无效的序号';
                    }
                } catch (err) {
                    console.error(err);
                    if (err.response) {
                        replyMsg = `HTTP Error: ${err.response.status}\n` + `Error Message: ${JSON.stringify(err.response.data)}`
                    } else {
                        replyMsg = '修改内容时发生未知错误，请稍后再试！';
                    }
                }
            } else {
                replyMsg = '无效的指令，请回复 /h 获取帮助';
            }
            break;
        case Content.includes('/b bb,'):
            const [key1, key2] = Content.split(',');
            console.log("[INFO] key 为：" + key2)
            if (key2.trim() === Binding_Key) {
                try {
                    // 存储绑定校验通过的用户
                    userConfig = new AV.Query('UserBindingStatus');
                    userConfig.equalTo('userId', FromUserName);
                    result = await userConfig.first();
                    if (!result) {
                        const UserBindingStatus = AV.Object.extend('UserBindingStatus');
                        const userBindingStatus = new UserBindingStatus();
                        userBindingStatus.set('userId', FromUserName);
                        userBindingStatus.set('isBinding', true);
                        await userBindingStatus.save();
                    } else {
                        try {
                            userConfig.select('isBinding');
                            result = await userConfig.first();
                            const isBinding = result ? result.get('isBinding') : null;
                            if (isBinding) {
                                result.set('isBinding', true);
                                await result.save();
                            }
                        } catch (err) {
                            console.error(err);
                            if (err.response) {
                                replyMsg = `HTTP Error: ${err.response.status}\n` + `Error Message: ${JSON.stringify(err.response.data)}`
                            } else {
                                replyMsg = '保存绑定状态 isBinding 出现未知错误，请稍后再试！';
                            }
                        }
                    }
                    replyMsg = '绑定成功，直接发「文字」或「图片」试试吧！\n---------------\n回复 /h 获取更多秘笈';
                } catch (err) {
                    console.error(err);
                    if (err.response) {
                        replyMsg = `HTTP Error: ${err.response.status}\n` + `Error Message: ${JSON.stringify(err.response.data)}`
                    } else {
                        replyMsg = '存储绑定关系请求出错，请稍后再试！';
                    }
                }
            } else {
                replyMsg = '本次绑定校验不通过，请回复以下命令绑定用户 /b bb,预置的环境变量 Binding_Key';
                console.log('[INFO] 5002 绑定校验不通过')
            }
            break;
        case command === '/nobb':
            try {
                userConfig = new AV.Query('UserBindingStatus');
                userConfig.equalTo('userId', FromUserName);
                result = await userConfig.first();
                if (!result) {
                    replyMsg = '您还未绑定，无需解除绑定。回复以下命令绑定用户 /b bb,预置的环境变量 Binding_Key';
                } else {
                    try {
                        await result.destroy();
                        if (tools.cache[FromUserName]) delete tools.cache[FromUserName]; //本地缓存中也删除
                        replyMsg = '您已成功解除绑定';
                    } catch (err) {
                        console.error(err);
                        if (err.response) {
                            replyMsg = `HTTP Error: ${err.response.status}\n` + `Error Message: ${JSON.stringify(err.response.data)}`
                        } else {
                            replyMsg = '本次解绑发生未知错误，解除绑定失败！';
                        }
                    }
                }
            } catch (err) {
                console.error(err);
                if (err.response) {
                    replyMsg = `HTTP Error: ${err.response.status}\n` + `Error Message: ${JSON.stringify(err.response.data)}`
                } else {
                    replyMsg = '验证绑定状态时发生未知错误，请稍后再试！';
                }
            }
            break;
        default:
            replyMsg = '无效的指令，请回复 /h 获取帮助';
            console.log('[INFO] 4003 无效的指令')
            break;
    }
    return replyMsg;
}

async function newbbTalk(Content, MsgType, Script = '') {
    let replyMsg = '';
    try {
        const data = { from: '✨ WeChat', content: Content };
        const content = AV.Object.extend('content');
        const contentObj = new content();
        contentObj.set('from', data.from);
        contentObj.set('content', data.content);
        contentObj.set('MsgType', MsgType);
        contentObj.set('other', Script);
        const response = await contentObj.save();
        if (response) {
            switch (true) {
                case MsgType == 'image':
                    replyMsg = '发图哔哔成功（使用 /f 指令可原内容前插入文字）\n-----------------\n' + Content
                    break;
                case MsgType == 'voice':
                    replyMsg = '发语音哔哔成功\n-----------------\n使用 /f 指令可原内容前插入文字'
                    break;
                case MsgType == 'video':
                    replyMsg = '发视频哔哔成功\n-----------------\n使用 /f 指令可原内容前插入文字'
                    break;
                case MsgType == 'shortvideo':
                    replyMsg = '发小视频哔哔成功\n-----------------\n使用 /f 指令可原内容前插入文字'
                    break;
                case MsgType == 'location':
                    replyMsg = '发位置哔哔成功\n-----------------\n使用 /f 指令可原内容前插入文字'
                    break;
                case MsgType == 'link':
                    replyMsg = '发链接哔哔成功\n-----------------\n使用 /f 指令可原内容前插入文字'
                    break;
                default:
                    replyMsg = '哔哔成功\n-----------------\n使用 /f 指令可原内容前插入文字，使用 /a 指令可原内容后追加文字';
                    break;
            }
        } else {
            replyMsg = '哔哔失败！' + response.data;
        }
    } catch (err) {
        console.error(err);
        if (err.response) {
            replyMsg = `HTTP Error: ${err.response.status}\n` + `Error Message: ${JSON.stringify(err.response.data)}`
        } else {
            replyMsg = '发布哔哔发生未知错误，请稍后再试！';
        }
    }
    return replyMsg;
}

module.exports = {
    handleCommand,
    newbbTalk
};