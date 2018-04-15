# Javascript to Typescript file convert

This is a simple wrapper around [lebab](https://github.com/lebab/lebab) for js to ts file refactoring

What it does

-----

- Renames files in a directory to .ts
- convert es5 to es6 code

commands

----

run `js-to-ts --dir <relativePath>` to convert files in a specific dir

run `js-to-ts ` to convert files in current dir

run `js-to-ts -delete` to delete all js files in current dir

run `js-to-ts -delete --dir <relativePath>` to delete all js files in relative dir