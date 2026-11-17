# 远程服务器指南：在服务器上运行 `dsh web`

本文说明如何让 DSH Remote 连到另一台机器上的 `dsh web`（DeepSeek Harness Web UI），以及监听地址、`--public-url`、`--trusted-host`、TLS、反向代理和 token URL 的关系。

`dsh web` 是 `dsh --profile web` 的简写；下文两者等价。

## 0. 最短路径

内网直连（无代理、无 TLS）时，只需要：

```sh
# 在远程服务器上执行
dsh web --host 10.0.0.7 --no-open
```

然后把启动输出里 `dsh web:` 那一整行 URL 粘贴到 DSH Remote 即可。其余章节用于反向代理、TLS、SSH 隧道和排错场景。

## 1. 监听地址：`--host` 与 `--port`

- 默认只监听 loopback（`127.0.0.1`），只有本机能访问。可用 `--host` 改成某个本机接口的**具体** IPv4/IPv6 地址。
- `--host` 不接受通配地址（`0.0.0.0`、`::` 等会在启动时被拒绝）。请写具体地址，例如 `--host 10.0.0.7`。
- `--port` 修改监听端口；默认端口是 3080。传 `0` 让操作系统挑选空闲端口。
- `--no-open` 让服务器端不尝试打开浏览器；在 SSH 会话中本来也会抑制自动打开。启动输出仍会打印 URL。

非 loopback 监听且没有启用 TLS 时，DSH 提供**明文 HTTP**并在启动时警告。明文只适合可信网络；跨不可信网络请使用 TLS（见第 4 节）或 SSH 隧道（见第 7 节）。

## 2. 公告入口：`--public-url`

当 DSH 在反向代理之后时，用 `--public-url` 告诉它浏览器实际使用的 HTTP(S) 根：

```sh
dsh web --host 127.0.0.1 --port 3080 --no-open \
  --public-url https://dsh.example.com/ \
  --trusted-host dsh.example.com
```

`--public-url` 会影响：

- 启动时打印的 `dsh web:` URL（DSH Remote 要粘贴的就是它）；
- 自动打开浏览器时使用的地址；
- `DSH_WEB_URL` 和 agent 运行时上下文里的 Web GUI 地址。

`--public-url` **不会**：

- 改变监听地址或端口；
- 配置代理、路由或 cookie 作用域；
- 授予任何信任（浏览器实际使用的 authority 仍需被 Host/Origin 栅栏接受，见下一节）。

它可以用在剥离前缀的代理入口上（例如 `https://app.example/ui/`），但监听器仍然只看到自己的根路径。

## 3. 信任栅栏：`--trusted-host`

DSH 有 Host/Origin 栅栏（覆盖 API 请求与 WebSocket 流）：默认只接受绑定地址本身（以及 loopback 场景下的本机地址）。通过主机名、域名或代理地址访问时，浏览器可见的 authority 必须被显式接受：

```sh
dsh web --host 10.0.0.7 --public-url https://app.example/ --trusted-host app.example
```

- `--trusted-host` 接受 `host` 或 `host:port` 形式的 authority，可重复传入多个。
- 反向代理必须保留（或设置成）一个已声明的 `Host`，否则 `/api` 请求会被栅栏拒绝。
- 公告与信任是两件事：`--public-url` 只负责“对外说地址”，`--trusted-host` 才负责“接受这个地址的请求”。

## 4. TLS

让监听器直接提供 HTTPS：

```sh
dsh web --host 10.0.0.7 \
  --tls-cert ./server-chain.pem \
  --tls-key ./server-key.pem \
  --public-url https://10.0.0.7:3080/
```

- `--tls-cert` 与 `--tls-key` 必须**同时**提供；只给一个会报用法错误，都不给则保持明文 HTTP。DSH 不会在失败时回退到 HTTP。
- 证书文件应包含完整证书链；私钥必须是不带口令的 PEM。
- 文件路径相对进程工作目录解析。文件缺失、不可读、为空或不是有效证书/密钥对时启动失败。
- DSH 不签发、不续期、不监视证书：没有 ACME 客户端，也没有自签名兜底。更换证书需要重启进程或重新加载监听器。
- 浏览器使用自己的信任库和主机名校验，证书的 subject alternative name 必须覆盖你实际访问的 authority。
- `--tls-cert` / `--tls-key` 覆盖的是**监听器**实际服务的 authority，不跟随 `--public-url`。如果 TLS 由反向代理终止，后端监听器通常保持 HTTP，由代理负责对外 HTTPS。
- TLS 不改变授权模型：token 交换与会话 cookie 认证仍然生效；监听器提供 HTTPS 时，它签发的会话 cookie 会带 `Secure`。

## 5. 反向代理要求

推荐用**独立主机名/子域**映射到后端根路径，例如 `https://dsh.example.com/` → `http://127.0.0.1:3080/`。代理需要：

1. **终止 TLS**（或直接透传，但客户端到入口建议是 HTTPS）。
2. **让后端看到根路径 `/`**：DSH 的启动 token 交换只在根路径生效（`authorizeIndex` 要求 `url.pathname === "/"`）。如果入口是 `https://example.com/dsh/`，代理必须剥离 `/dsh` 前缀（见下方“为什么 token URL 只在根路径生效”）。
3. **保留完整查询串**：一次性 token 在查询参数里，不能被丢弃或改写。
4. **转发 `Host`**：保留浏览器访问的 authority，或在 `--trusted-host` 中声明代理改写后的值；同时转发 `Origin`。
5. **支持 WebSocket upgrade**（聊天与流式响应需要），并关闭响应缓冲。
6. **不要缓存** `/` 或 `/api` 响应。
7. 正确传递 `Set-Cookie` / `Location`。若使用路径前缀，还要保证重定向与 cookie 路径仍落在入口前缀下，否则浏览器会被带回站点根。

Nginx 示例（独立子域，最简单，也最不容易出错）：

```nginx
server {
    listen 443 ssl;
    server_name dsh.example.com;

    ssl_certificate     /etc/ssl/dsh/fullchain.pem;
    ssl_certificate_key /etc/ssl/dsh/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_buffering off;
    }
}
```

对应启动：

```sh
dsh web --host 127.0.0.1 --port 3080 --no-open \
  --public-url https://dsh.example.com/ \
  --trusted-host dsh.example.com
```

如果确实需要路径前缀（如 `https://example.com/dsh/`），推荐**不要**这么做；非做不可时，代理需要剥掉前缀并同时修正重定向和 cookie 路径，否则 token 交换完成后页面会被导航回站点根。

### 为什么 token URL 只在根路径 `/` 生效

DSH 的 token 交换端点（`authorizeIndex`）只在请求路径正好是 `/` 时处理 token 并签发 cookie。`https://example.com/dsh/?token=...` 在代理不剥离前缀时，后端看到的 path 是 `/dsh/`，token 不会被兑换。因此：

- 用独立子域把入口映射到后端根路径，最省事；
- 或者让代理把前缀剥离，使后端始终看到 `/`；
- `--public-url` 可以带路径前缀，但那只是“公告给浏览器看的地址”，不会让 token 交换接受非根路径。

## 6. 复制带 token 的启动 URL

启动后输出类似：

```
dsh web: https://dsh.example.com/?token=AbC123...
```

- **整行复制**，粘贴到 DSH Remote 的新建服务器或重新认证窗口。
- token 是一次性进程凭据：每次启动/重启 `dsh` 都会变化。
- token 只应与预期用户分享。不要把它贴到聊天、工单、日志或截图里。
- DSH Remote 用 token 换取签名 cookie 后，只保存干净的 base URL（不含 token）。
- 如果配置项 `printUrl` 被设为 `false`，这一行不会打印。需要重新获取 token 时，请临时恢复 `printUrl: true` 后重启进程；不要尝试从别处推断 token。
- 认证 URL 的 host 必须与已保存服务器的 host 一致。若 token URL 指向另一个地址（例如通过 SSH 隧道改写了主机名），请以该地址新建服务器，而不是编辑已有服务器。

### SSH 场景

通过 SSH 启动时，DSH 仍会打印 URL，但不会在服务器端打开浏览器（它也无法打开到你的屏幕）。你有两种接法：

1. 使用 `--public-url` 公告一个你的电脑能访问的地址（例如公司内网域名），直接复制打印出的 URL；
2. 使用 SSH 本地端口转发，再把 URL 里的 `host:port` 换成隧道本地地址，token 查询参数保持不变。

## 7. 防火墙与 SSH 隧道

- **不要把 3080 直接暴露到公网。** 端口本身没有额外保护，token 交换和 cookie 是唯一的认证手段。只对可信代理、跳板机或内网网段开放。
- 明文 HTTP 只应存在于 loopback、SSH 隧道或可信内网；跨网络请用 TLS。
- 客户端不内置 SSH 隧道，需要你自行建立。示例：

  ```sh
  # 在你的电脑上
  ssh -N -L 3080:127.0.0.1:3080 user@server

  # 在服务器上（保持默认 loopback 监听）
  dsh web --no-open
  ```

  然后在 DSH Remote 中使用 `http://127.0.0.1:3080/`。首次认证时，把打印出的 token URL 中的主机和端口改为 `127.0.0.1:3080`，token 参数原样保留后粘贴。绑定 loopback 时，Host/Origin 栅栏接受 `127.0.0.1` 这个 authority，因此隧道场景可以正常工作。
- 如果服务器绑定的是非 loopback 地址，请确保防火墙只允许你的来源地址或前置代理访问该端口。
- 代理与证书相关的客户端侧设置（系统代理/直连、自签名证书信任）在 DSH Remote 的服务器设置中调整。

## 8. 常见问题

| 现象 | 可能原因 | 处理 |
| --- | --- | --- |
| 粘贴 token URL 后立刻 401 | token 已随进程重启失效 | 重新启动 `dsh web`，复制新的 `dsh web:` URL |
| 页面能打开，但聊天/API 返回 401 或 403 | cookie 过期，或反代丢失查询串/cookie | 检查代理是否保留查询串与 `Set-Cookie`，必要时重新认证 |
| 403、Host 不被信任 | 访问的 authority 没被 Host/Origin 栅栏接受 | 加 `--trusted-host <host[:port]>`，或改走剥离前缀的代理入口 |
| 页面加载失败、证书错误 | 证书链不完整、SAN 不覆盖访问的域名，或客户端不信任 | 修好证书；内网自签名场景可在客户端对该服务器显式“允许无效证书” |
| token 交换失败、跳回站点根 | 反向代理没有剥离路径前缀 | 改用独立子域，或让代理剥离前缀并修正重定向/cookie 路径 |
| 客户端连不上、浏览器也打不开 | 端口未开放、绑定地址不对，或公司代理拦截了内网地址 | 检查防火墙与 `--host`；在客户端把该服务器改为“直连” |
| 能连上但很慢/工具调用卡住 | 代理未启用 WebSocket upgrade 或缓冲了流式响应 | 按第 5 节配置 `Upgrade` / `Connection` 并关闭 `proxy_buffering` |

更多客户端侧说明见仓库根目录的 [README](../README.md)；macOS 打包与未签名安装见 [macOS 未签名安装](macos-unsigned.md)。