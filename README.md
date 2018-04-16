[![npm version](https://badge.fury.io/js/%40epicallan%2Fjs-to-ts.svg)](https://badge.fury.io/js/%40epicallan%2Fjs-to-ts)

# Javascript to Typescript file convert

Heavily relying on [lebab](https://github.com/lebab/lebab) for es5 to es6 conversion

## What it does

-----

- convert es5 to es6 code
- Renames files in a directory to .ts
- delete left over js files by commandline see commands usage below

## Commands / usage

-----
install by using yarn or npm

```
 npm install -g @epicallan/js-to-ts
```

run `js-to-ts --dir <relativePath>` to convert files in a specific dir

run `js-to-ts ` to convert files in current dir

run `js-to-ts -d` to delete all js files in current dir

run `js-to-ts -d --dir <relativePath>` to delete all js files in relative dir
