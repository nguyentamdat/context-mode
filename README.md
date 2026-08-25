# pitada

Một Pi package để cài lại bộ extension hiện dùng bằng một lệnh.

```bash
pi install git:github.com/nguyentamdat/pitada@v0.1.0
```

Sau khi cài, đăng nhập/cấu hình riêng cho máy mới bằng `pi config`. Package này không chứa token, file `auth.json`, hay thiết lập cá nhân.

## Extension local được bundle

- `backlog-md` (cần CLI `backlog` nếu dùng)
- `cbmem` (cần `codebase-memory-mcp`; có thể đặt `CBM_BIN` nếu binary không nằm trên `PATH`)
- `codex-usage-status`
- `herdr-agent-state` (chỉ hoạt động khi chạy trong Herdr)
- `local-telemetry`
- `tool-output-chars`

Các Pi package phụ thuộc được khóa theo version trong `package.json` và bundle khi publish npm.

## Phát hành

```bash
npm install
npm version patch
git push --follow-tags
```

Nếu publish lên npm private, dùng `npm publish --access restricted` rồi cài bằng `pi install npm:@nguyentamdat/pitada@<version>`.
