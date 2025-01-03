const AV = require('leanengine');
const config = require('../config');
const { createLogger } = require('../utils/logger');

const logger = createLogger('ContentService');

class ContentService {
  constructor() {
    this.pageSize = config.PageSize || 10;
  }

  // 获取最近内容
  async getRecentContent(limit = 10) {
    try {
      const query = new AV.Query('content');
      query.limit(limit);
      query.descending('createdAt');
      return await query.find();
    } catch (err) {
      logger.error('获取最近内容失败:', err);
      throw err;
    }
  }

  // 搜索内容
  async searchContent(keyword) {
    try {
      const query = new AV.Query('content');
      query.contains('content', keyword);
      query.descending('createdAt');
      return await query.find();
    } catch (err) {
      logger.error('搜索内容失败:', err);
      throw err;
    }
  }

  // 分页获取内容
  async getContentByPage(pageNum = 1) {
    try {
      const query = new AV.Query('content');
      query.descending('createdAt');
      query.skip((pageNum - 1) * this.pageSize);
      query.limit(this.pageSize);

      const [results, count] = await Promise.all([
        query.find(),
        query.count()
      ]);

      return {
        results,
        count,
        pageNum,
        pageSize: this.pageSize,
        totalPages: Math.ceil(count / this.pageSize)
      };
    } catch (err) {
      logger.error('分页获取内容失败:', err);
      throw err;
    }
  }

  // 根据ID获取内容
  async getContentById(id) {
    try {
      const query = new AV.Query('content');
      return await query.get(id);
    } catch (err) {
      logger.error('根据ID获取内容失败:', err);
      throw err;
    }
  }

  // 创建新内容
  async createContent(data) {
    try {
      const Content = AV.Object.extend('content');
      const content = new Content();

      content.set({
        content: data.content,
        from: data.from || '✨ WeChat',
        MsgType: data.MsgType || 'text',
        other: data.other || ''
      });

      const result = await content.save();
      logger.info('创建内容成功: {0}', result.id);
      return result;
    } catch (err) {
      logger.error('创建内容失败:', err);
      throw err;
    }
  }

  // 更新内容
  async updateContent(id, data) {
    try {
      const content = await this.getContentById(id);
      if (!content) {
        throw new Error('内容不存在');
      }

      if (data.content) content.set('content', data.content);
      if (data.from) content.set('from', data.from);
      if (data.MsgType) content.set('MsgType', data.MsgType);
      if (data.other) content.set('other', data.other);

      const result = await content.save();
      logger.info('更新内容成功: {0}', id);
      return result;
    } catch (err) {
      logger.error('更新内容失败:', err);
      throw err;
    }
  }

  // 删除内容
  async deleteContent(id) {
    try {
      const content = await this.getContentById(id);
      if (!content) {
        throw new Error('内容不存在');
      }

      await content.destroy();
      logger.info('删除内容成功: {0}', id);
      return true;
    } catch (err) {
      logger.error('删除内容失败:', err);
      throw err;
    }
  }

  // 批量删除内容
  async batchDeleteContent(ids) {
    try {
      const objects = await Promise.all(
        ids.map(id => this.getContentById(id))
      );

      await AV.Object.destroyAll(objects);
      logger.info('批量删除内容成功, 数量: {0}', ids.length);
      return true;
    } catch (err) {
      logger.error('批量删除内容失败:', err);
      throw err;
    }
  }

  // 统计内容数量
  async countContent(conditions = {}) {
    try {
      const query = new AV.Query('content');

      if (conditions.from) {
        query.equalTo('from', conditions.from);
      }
      if (conditions.MsgType) {
        query.equalTo('MsgType', conditions.MsgType);
      }
      if (conditions.startDate) {
        query.greaterThanOrEqualTo('createdAt', conditions.startDate);
      }
      if (conditions.endDate) {
        query.lessThanOrEqualTo('createdAt', conditions.endDate);
      }

      const count = await query.count();
      logger.debug('统计内容数量: {0}', count);
      return count;
    } catch (err) {
      logger.error('统计内容数量失败:', err);
      throw err;
    }
  }
}

module.exports = new ContentService(); 