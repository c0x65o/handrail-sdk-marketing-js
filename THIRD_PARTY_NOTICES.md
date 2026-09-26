# Third-party dependencies

The lockfile records the exact dependency versions and integrity values. No
third-party implementation is vendored. npm installs each dependency with its
own license files, which must remain with redistributed dependency copies.

Direct runtime dependencies: mysql2 (MIT), openai (Apache-2.0), sharp
(Apache-2.0), React and React DOM (MIT). sharp's platform libvips distributions
include additional dependency notices and LGPL-3.0-or-later terms; retain those
notices and applicable replacement/relinking rights when distributing binaries.

Development/build dependencies: TypeScript (Apache-2.0), Vite and its React plugin
(MIT), Node/React type declarations (MIT), Playwright (Apache-2.0). Browser engines
and system MariaDB/ffmpeg are separate tools with their own distribution terms;
this repository does not redistribute them.

The PNG/MP4 test patterns are retained synthetic SDK fixtures, not campaign media
or private application data. The extracted support modules are Handrail source
under the same reserved rights described in RIGHTS.md.

## React, React DOM and Scheduler in the prepared reference UI

The normal prepare build bundles these MIT-licensed runtime components.
Their applicable notice is retained below and copied beside the built assets.

MIT License

Copyright (c) Meta Platforms, Inc. and affiliates.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
