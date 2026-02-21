# Release Notes

This directory contains release notes for each version of SharX.

## Structure

Each release should have a corresponding markdown file named after the version tag:

- `v1.0.0.md` - Release notes for version 1.0.0
- `v1.0.1.md` - Release notes for version 1.0.1
- `v1.0.0-beta.md` - Release notes for beta version 1.0.0-beta

## File Naming

The file name should match the tag exactly:
- Tag: `v1.0.0` → File: `v1.0.0.md`
- Tag: `1.0.0` → File: `1.0.0.md`
- Tag: `v1.0.0-beta` → File: `v1.0.0-beta.md`

## Automatic Usage

The GitHub Actions workflow automatically:
1. Looks for a release notes file matching the tag
2. Uses it as the release description
3. Falls back to default description if file not found

## Template

When creating a new release notes file, include:

- **Key Features** - Main features of this release
- **Docker Images** - Image tags and versions (use placeholders)
- **Quick Start** - Usage instructions
- **What's New** - New features and improvements
- **Changes** - Detailed changelog or link to commits

## Placeholders

You can use the following placeholders in release notes files. They will be automatically replaced with actual values:

- `{{SHARX_TAG_VERSION}}` - SharX image with version tag (e.g., `registry.konstpic.ru/sharx/sharx:1.0.0`)
- `{{SHARX_TAG_LATEST}}` - SharX image with latest tag
- `{{SHARXNODE_TAG_VERSION}}` - SharXNode image with version tag
- `{{SHARXNODE_TAG_LATEST}}` - SharXNode image with latest tag
- `{{HARBOR_HOST}}` - Harbor registry host
- `{{HARBOR_PROJECT}}` - Harbor project name

See `v1.0.0.md` for an example.
