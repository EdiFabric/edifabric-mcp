# Changelog

The version is set in `package.json`; `npm version` copies it into `server.json`, the Claude Code plugin and the Claude Desktop bundle. See [RELEASING.md](RELEASING.md).

## 0.1.0

First version, not published.

- Tools: `parse_edi`, `validate_edi`, `acknowledge_edi`, `build_edi`, `split_edi`, `describe_spec` and `get_status`, for X12 and HIPAA.
- `describe_spec` reads the same model as parsing: a local or custom model from `EDIFABRIC_MAP`, otherwise the standard model downloaded with the serial. It returns an outline, one segment's elements, codes and syntax rules, or a JSON skeleton for `build_edi`.
- Uses ediFabric Native 1.2.1 through the `edifabric-x12` package.
