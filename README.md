# BBtalk-Serverless
https://blog.guole.fun/bb/ 的配套微信公众号发布云函数
  
* author: guole
* https://blog.guole.fun/
* license: Apache-2.0
* https://github.com/kuole-o/BBtalk-Serverless/main/LICENSE
  
## 更新日志

<details>
<summary>v1.0.7</summary>
  * 修复：使用`/d`命令时，无法正常删除 cos 中对应资源的 Bug；<br> 
</details>

<details>
<summary>v1.0.6</summary>
  * 改进：现在数据表中的 `other` 字段可以存储一个自定义的 JSON 结构音乐信息（如 {"name":"有空地的地方就有人跳舞 (居家Demo版)","artist":"新裤子","cover":"https://xxx/xxx.jpg","url":"https://xxx/xxx.mp3","lrc":""}），配合 bbtalk.js 实现某些 vip 歌曲的自定义说说引用播放（此时`MsgType`需要为“music”）；<br> 
  * 新增一个`upload-bbtalk-cos.js`方法，用来在一些单独调用 LeanCloud 接口或反代理接口时（比如用 Siri 捷径发说说，不走公众号），通知 cos 更新最新的 LeanCloud 分页 JSON 数据；使用时，单独再新建一个云函数，需要环境变量`Binding_Key`，调用接口时可以用 GET 方式传参“?binding-key=xxxx” 或 POST 方式在 heards 中传参 “binding-key=xxxx”。请求地址是配置完云函数，绑定的“触发器”公网地址；<br> 
  * 最新的前端 `bbtalk.js` 可以去我博客扒。已支持 QQ 音乐或网易云音乐单首歌曲或歌单的分享。（在 app 里点击“分享”找到“复制链接”，用这个链接才可以获取到歌曲id或歌单id。一般直接分享会有个小程序链接之类的，或者其他短链接，在浏览器访问一次，然后复制那个 URL 就行了）；<br> 
  * 修复：使用`/d`命令时，可能就无法正常删除 cos 中对应资源的 Bug；<br> 
</details>

<details>
<summary>v1.0.5</summary>
  * 改进：发图片时，不再拼接成 `<img>` 标签，交给前端渲染时处理；<br> 
  * 修复：`/a` 与 `/f` 命令中，未明确处理第几条内容而默认处理最近 1 条说说时，回复文案异常的问题<br>  
</details>

<details>
<summary>v1.0.4</summary>
  * 优化：图片或视频不再云函数中转成`html`标签，直接写入`URL`，由客户端处理插入 <br>  
</details>

<details>
<summary>v1.0.3</summary>
  * Bugfix：解决 /e 命令部分场景下匹配不到的问题； <br>  
  * 优化：/a /f /e 匹配方式合并统一；若非删除、新增闪念（说明除了被操作这一条所在的页需要更新外，其他页无需更新）操作，只拉取当前页`pageSize`条数据更新 JSON，非 1000 条，数据量大时可提升性能； <br>  
</details>

<details>
<summary>v1.0.2</summary>
  * 优化 LeanCloud 批量获取、COS 批量上传 JSON 逻辑，改善超时导致的微信异常响应问题（微信最多等待 5s，若说说过多，分批一次 1000 条仍然超过 5s ，那就没办法了……不过这种情况下，虽然微信提示“服务异常”，但是云函数会正常执行。只是看起来有点膈应……） <br>  
</details>

<details>
<summary>v1.0.1</summary>
  * 新增回复内容超长，自动截断逻辑，避免微信异常响应 <br>  
  * 抽离多个环境变量，详见使用指引 <br>  
  * 新增说说内容转储为 json，上传 cos 功能，前端直接请求这个 json ，通过腾讯云 CDN 加速，提升访问速度，详见使用指引 <br>  
</details>

<details>
<summary>v1.0.0</summary>
  * 首版本 <br>
</details>
  
## 特性
  
* 包含
  * 部署在云函数上，无需服务器   
  * 使用微信随时随地发布闪念瞬间（memos 很香，但是得有机器……）  
  * 在原来 [@木木木](https://github.com/lmm214) 的 `bber-weixin` 基础上升级而来，**新增支持：发位置、发链接卡片、发视频功能**；
  * 发图片：直接拍照片或发本地图片给公众号既可（存在腾讯云 cos ，原有的去不图床逻辑没删，但我也没验证）；  
  * 发视频：录视频、或本地视频直接发给公众号既可（存在腾讯云 cos）；  
  * 发位置：需要在 /bb/ 页面引入资源，详见使用指南；（其他页面嵌入地图，见另一个插件：[hexo-tag-map](https://github.com/kuole-o/hexo-tag-map)）  
  * 发链接卡片：直接分享卡片到公众号；  
  * ~~发语音：本来想借用 FFmpeg 在服务端转换语音音频 amr 为 mp3，前端再调 aplayer 等播放，但是夭折了……云函数里一直搞不定 FFmpeg 的环境……~~  
  
### 哔哔秘笈
  
```text
    「哔哔秘笈」
    ==================
    /l 查询最近 10 条哔哔
    /l 数字 - 查询最近前几条，如 /l3
    ---------------
    /a 文字 - 最新一条原内容后追加文字
    /a 数字 文字 - 第几条原内容后追加文字，如 /a3 开心！
    ---------------
    /f 文字 - 最新一条原内容前插入文字
    /f 数字 文字 - 第几条原内容前插入文字，如 /f3 开心！
    ---------------
    /s 关键词 - 搜索内容
    ---------------
    /d 数字 - 删除第几条，如 /d2
    ---------------
    /e 文字 - 编辑替换第 1 条
    /e 数字 文字 - 编辑替换第几条，如 /e2 新内容
    ---------------
    /nobber - 解除绑定
```
  
## [演示页面](https://blog.guole.fun/bb/)  
  
[详细用法，请点击这里查看](https://blog.guole.fun/posts/17745/)
