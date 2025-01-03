const AV = require('leanengine');
const config = require('./config');
const tools = require('./tools');
const { createLogger } = require('./utils/logger');
const contentService = require('./services/contentService');

const logger = createLogger('HandleCommand');

// 从配置中获取环境变量
const {
    SubDomain,
    SecondLevelDomain,
    TopDomain,
    Tcb: {
        ImagePath: Tcb_ImagePath,
        MediaPath: Tcb_MediaPath,
        Bucket: Tcb_Bucket,
        Region: Tcb_Region,
        JsonPath: Tcb_JsonPath
    },
    PageSize,
    Binding: { Key: Binding_Key }
} = config;

// 抽取通用的内容查询方法
async function queryContent(params = 1) {
    const query = new AV.Query('content');
    query.limit(params);
    query.descending('createdAt');
    return await query.find();
}

// 抽取通用的内容更新方法
async function updateContent(object, content) {
    object.set('content', content);
    await object.save();
    await tools.queryContentByPage(Tcb_Bucket, Tcb_Region, Tcb_JsonPath, 1, PageSize, true);
}

async function handleCommand(command, params, Content, FromUserName) {
    try {
        // 处理特殊命令
        if (command === '/nobb') {
            return await commandHandlers['/nobb'](FromUserName);
        }

        // 处理类似 /l3、/a1、/f2、/e12 这样的无空格命令格式
        if (command.length > 2) {
            const actualCommand = command.substring(0, 2);
            // 检查是否是支持的命令
            if (['/l', '/a', '/f', '/s', '/e', '/d'].includes(actualCommand)) {
                const actualParams = parseInt(command.substring(2));
                if (!isNaN(actualParams)) {
                    // 对于 /a、/f、/e 命令，需要处理后面的内容
                    if (['/a', '/f', '/e'].includes(actualCommand)) {
                        // 从原始Content中提取实际内容部分
                        const contentPart = Content.substring(command.length).trim();
                        if (!contentPart) {
                            return `无效的指令，请输入 "${actualCommand} ${actualParams} 内容"`;
                        }
                        return await commandHandlers[actualCommand](actualParams, contentPart, FromUserName);
                    }
                    // 其他命令直接处理
                    return await commandHandlers[actualCommand](actualParams, Content, FromUserName);
                }
            }
        }

        // 处理正常的空格分隔命令格式
        const handler = commandHandlers[command];
        if (!handler) {
            return '无效的指令，请回复 /h 获取帮助';
        }

        return await handler(params, Content, FromUserName);
                } catch (err) {
        return tools.handleError(err);
    }
}

// 在文件顶部添加删除状态缓存
const deleteStatusCache = new Map();

const commandHandlers = {
    '/h': async () => {
        return '「哔哔秘笈」\n' +
            '==================\n' +
            '/l 查询最近 10 条哔哔\n' +
            '/l 数字 - 查询最近前几条，如 /l3\n' +
            '---------------\n' +
            '/a 文字 - 最新一条原内容后追加文字\n' +
            '/a 数字 文字 - 第几条原内容后追加文字，如 /a3 开心！\n' +
            '---------------\n' +
            '/f 文字 - 最新一条原内容前插入文字\n' +
            '/f 数字 文字 - 第几条原内容前插入文字，如 /f3 开心！\n' +
            '---------------\n' +
            '/s 关键词 - 搜索内容\n' +
            '---------------\n' +
            '/d 数字 - 删除第几条，如 /d2\n' +
            '---------------\n' +
            '/e 文字 - 编辑替换第 1 条\n' +
            '/e 数字 文字 - 编辑替换第几条，如 /e2 新内容\n' +
            '---------------\n' +
            '/nobb - 解除绑定';
    },

    '/l': async (params) => {
        const limit = params || 10;
        const results = await contentService.getRecentContent(limit);
        return tools.generateReplyMsg('list', results);
    },

    '/s': async (_, Content) => {
        const searchContent = Content.match(/^\/s\s*(.*)$/i)?.[1];
        if (!searchContent) {
            return '无效的指令，请输入 /s 关键词查询';
        }

        const results = await contentService.searchContent(searchContent);
        return tools.generateReplyMsg('search', results, searchContent);
    },

    '/d': async (params, _, FromUserName) => {
        if (!params) {
            return '无效的参数，请输入 /d 数字以删除指定哔哔';
        }

        try {
            // 检查是否正在处理中
            const cacheKey = `${FromUserName}_${params}`;
            const status = deleteStatusCache.get(cacheKey);

            if (status) {
                if (status.completed) {
                    // 删除已完成，返回结果
                    deleteStatusCache.delete(cacheKey);
                    return status.result || '删除成功';
                } else {
                    // 仍在处理中
                    return 'success';
                }
            }

            // 第一次处理，先返回消息
            deleteStatusCache.set(cacheKey, { completed: false });
            
            // 异步处理删除操作
            processDeleteAsync(params, cacheKey).catch(err => {
                logger.error('异步删除内容失败:', err);
                deleteStatusCache.set(cacheKey, {
                    completed: true,
                    result: tools.handleError(err)
                });
            });

            return '正在删除，请稍候...';
        } catch (err) {
            logger.error('删除内容失败:', err);
            return tools.handleError(err);
        }
    },

    '/a': async (params, Content) => {
        if (!Content) {
            return '无效的指令，请输入 "/a 内容"，追加内容到第 1 条';
        }

        try {
            const results = await queryContent(params || 1);
            const index = params ? params - 1 : 0;
            if (results[index]) {
                const object = results[index];
                const oldContent = object.get('content');
                await updateContent(object, oldContent + Content);
                return `已追加文本到第 ${params || 1} 条`;
            }
            return '无效的序号';
                        } catch (err) {
            logger.error('追加内容失败:', err);
            return tools.handleError(err);
        }
    },

    '/f': async (params, Content) => {
        if (!Content) {
            return '无效的指令，请输入 "/f 内容"，插入内容到第 1 条';
        }

        try {
            const results = await queryContent(params || 1);
            const index = params ? params - 1 : 0;
            if (results[index]) {
                const object = results[index];
                const oldContent = object.get('content');
                await updateContent(object, Content + oldContent);
                return `已插入文本到第 ${params || 1} 条`;
            }
            return '无效的序号';
                } catch (err) {
            logger.error('插入内容失败:', err);
            return tools.handleError(err);
        }
    },

    '/e': async (params, Content) => {
        if (!Content) {
            return '无效的指令，请回复 /h 获取帮助';
        }

        try {
            const results = await queryContent(params || 1);
            if (results[params - 1]) {
                const object = results[params - 1];
                await updateContent(object, Content);
                return `已修改第 ${params} 条内容为：${Content}`;
            }
            return '无效的序号';
        } catch (err) {
            logger.error('修改内容失败:', err);
            return tools.handleError(err);
        }
    },

    '/b': async (_, Content, FromUserName) => {
        const key = Content.substring(3).trim();
        logger.debug('绑定密钥: {0}', key);

        if (key === Binding_Key) {
            try {
                await tools.bindUser(FromUserName);
                return '绑定成功，直接发「文字」或「图片」试试吧！\n---------------\n回复 /h 获取更多秘笈';
            } catch (err) {
                logger.error('绑定用户失败:', err);
                return tools.handleError(err);
            }
        }

        logger.warn('绑定校验不通过, 用户: {0}', FromUserName);
        return '本次绑定校验不通过，请回复以下命令绑定用户：/b 环境变量Binding_Key';
    },

    '/nobb': async (FromUserName) => {
        try {
            const result = await tools.unbindUser(FromUserName);
            return result ? '您已成功解除绑定' :
                '您还未绑定，无需解除绑定。回复以下命令绑定用户：/b 环境变量Binding_Key';
        } catch (err) {
            logger.error('解除绑定失败:', err);
            return tools.handleError(err);
        }
    }
};

// 异步处理删除操作
async function processDeleteAsync(params, cacheKey) {
    try {
        const results = await queryContent(params);
        const index = params - 1;

        if (results[index]) {
            const object = results[index];
            const content = object.get('content');
            logger.info('准备删除内容: {0}', content);

            // 检查是否需要删除关联的媒体文件
            const mediaUrl = tools.extractMediaUrl(content);
            if (mediaUrl) {
                await tools.deleteMediaFile(mediaUrl);
            }

            await object.destroy();
            await tools.queryContentByPage(Tcb_Bucket, Tcb_Region, Tcb_JsonPath, 1, PageSize, true);
            
            // 更新缓存状态
            deleteStatusCache.set(cacheKey, {
                completed: true,
                result: '删除成功'
            });
        } else {
            deleteStatusCache.set(cacheKey, {
                completed: true,
                result: '无效的序号'
            });
        }
    } catch (err) {
        throw err;
    }
}

// 添加定期清理过期的删除状态缓存
const DELETE_CACHE_CLEANUP_INTERVAL = 5 * 60 * 1000; // 5分钟
const DELETE_CACHE_EXPIRE_TIME = 60 * 1000; // 1分钟

setInterval(() => {
    const now = Date.now();
    for (const [key, value] of deleteStatusCache) {
        if (value.timestamp && now - value.timestamp > DELETE_CACHE_EXPIRE_TIME) {
            deleteStatusCache.delete(key);
            logger.debug('清理过期删除状态缓存: {0}', key);
        }
    }
}, DELETE_CACHE_CLEANUP_INTERVAL);

async function newbbTalk(Content, MsgType, Script = '') {
    logger.info('发布新内容, 类型: {0}', MsgType);

    try {
        const contentObj = new (AV.Object.extend('content'))();
        contentObj.set({
            from: '✨ WeChat',
            content: Content,
            MsgType,
            other: Script
        });

        const response = await contentObj.save();
        logger.debug('内容保存成功:', response);

        if (!response) {
            logger.error('发布失败, 响应:', response);
            return '哔哔失败！' + response.data;
        }

        // 更新所有分页 JSON 文件
        await tools.queryContentByPage(Tcb_Bucket, Tcb_Region, Tcb_JsonPath, 1, PageSize, true);

        // 统一的提示信息
        const baseMsg = '使用 /f 指令可原内容前插入文字';
        const appendMsg = '，使用 /a 指令可原内容后追加文字';
        const divider = '\n-----------------\n';

        switch (MsgType) {
            case 'image':
                return `发图哔哔成功（${baseMsg}）${divider}${Content}`;
                
            case 'voice':
                return `发语音哔哔成功${divider}${baseMsg}`;
                
            case 'video':
                return `发视频哔哔成功${divider}${baseMsg}`;
                
            case 'shortvideo':
                return `发小视频哔哔成功${divider}${baseMsg}`;
                
            case 'location':
                return `发位置哔哔成功${divider}${baseMsg}`;
                
            case 'link':
                return `发链接哔哔成功${divider}${baseMsg}`;
                
            case 'text':
                return `哔哔成功${divider}${baseMsg}${appendMsg}`;
                
                default:
                return `发布${MsgType}类型内容成功${divider}${baseMsg}${appendMsg}`;
        }
    } catch (err) {
        logger.error('发布内容失败:', err);
        return tools.handleError(err);
    }
}

module.exports = {
    handleCommand,
    newbbTalk
};