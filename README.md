# pitada

Một Pi package để cài lại bộ extension và cấu hình hiện dùng bằng một package.

```bash
pi install git:github.com/nguyentamdat/pitada@v0.1.2
```

## Khôi phục cấu hình

Sau khi cài, chạy script đi kèm (script tự tạo backup cho từng file trước khi ghi đè):

```bash
node ~/.pi/agent/git/github.com/nguyentamdat/pitada/scripts/restore-config.mjs --apply
```

Trên Windows, dùng đường dẫn tương đương bên trong `%USERPROFILE%\.pi\agent\git\github.com\nguyentamdat\pitada`.

Cấu hình được lưu gồm Pi settings, Hindsight, MCP, multi-pass, provider failover và backlog. `auth.json`, cache, session, telemetry và mọi giá trị token/secret **không** được commit. Khởi động lại Pi, đăng nhập lại và thay các giá trị `<set-on-target>` nếu có.

## Extension local được bundle

- `backlog-md` (cần CLI `backlog` nếu dùng)
- `cbmem` (cần `codebase-memory-mcp`; có thể đặt `CBM_BIN` nếu binary không nằm trên `PATH`)
- `codex-usage-status`
- `herdr-agent-state` (chỉ hoạt động khi chạy trong Herdr)
- `local-telemetry`
- `tool-output-chars`

Các Pi package phụ thuộc được khóa theo version trong `package.json` và bundle khi publish npm.

## Cập nhật snapshot cấu hình

Trên máy nguồn, sau khi thay đổi config không nhạy cảm:

```bash
node scripts/snapshot-config.mjs
```

Review diff trước khi commit; script luôn bỏ giá trị theo các key token/secret/password/API key/access/refresh/cookie.
