# @jedwards1211/rerun

[![CircleCI](https://circleci.com/gh/jedwards1211/rerun.svg?style=svg)](https://circleci.com/gh/jedwards1211/rerun)
[![Coverage Status](https://codecov.io/gh/jedwards1211/rerun/branch/master/graph/badge.svg)](https://codecov.io/gh/jedwards1211/rerun)
[![semantic-release](https://img.shields.io/badge/%20%20%F0%9F%93%A6%F0%9F%9A%80-semantic--release-e10079.svg)](https://github.com/semantic-release/semantic-release)
[![Commitizen friendly](https://img.shields.io/badge/commitizen-friendly-brightgreen.svg)](http://commitizen.github.io/cz-cli/)
[![npm version](https://badge.fury.io/js/%40jedwards1211%2Frerun.svg)](https://badge.fury.io/js/%40jedwards1211%2Frerun)

```
yarn install @jedwards1211/rerun
```

I wanted an easier way to rerun an arbitrary command when files change, like nodemon but more convenient,
especially for non-JS projects.

For me this is the easiest syntax:

```sh
rerun 'src/**.{c,h,cpp}' -- ./build.sh
```

That is,

```
rerun <files, directories, glob patterns ...> -- <command>
```

Any number of directories/glob patterns can be given, and any number of command arguments, they just have to
be separated by `--`.

Right now there are no options. It will retry three times on nonzero exit codes.
