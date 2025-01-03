const { LogLevel } = require('./utils/logger');

module.exports = {
    TopDomain: process.env.TopDomain,
    SecondLevelDomain: process.env.SecondLevelDomain,
    SubDomain: process.env.SubDomain,
    PageSize: parseInt(process.env.PageSize) || 10,
    
    // 腾讯云配置
    Tcb: {
        Bucket: process.env.Tcb_Bucket,
        Region: process.env.Tcb_Region,
        JsonPath: process.env.Tcb_JsonPath || '/json/',
        ImagePath: process.env.Tcb_ImagePath || '/images/',
        MediaPath: process.env.Tcb_MediaPath || '/media/',
        SecretId: process.env.Tcb_SecretId,
        SecretKey: process.env.Tcb_SecretKey
    },
    
    // 微信配置
    WeChat: {
        token: process.env.WeChat_Token,
        encodingAesKey: process.env.WeChat_encodingAesKey,
        appId: process.env.WeChat_appId,
        appSecret: process.env.WeChat_appSecret
    },
    
    // 用户绑定配置
    Binding: {
        Key: process.env.Binding_Key
    },
    
    // 上传配置
    Upload_Media_Method: process.env.Upload_Media_Method || 'cos',
    
    // 日志配置
    logLevel: process.env.LOG_LEVEL ? 
        parseInt(process.env.LOG_LEVEL) : 
        LogLevel.INFO
}; 