
let gulp = require('gulp');
let watch = require('gulp-watch');
let del = require('del');
let fs = require('fs');
let ts = require('typescript');
let concat = require('gulp-concat');
let through = require('through2');
let terser = require('terser');


let tmplFolder = 'tmpl'; //template folder
let srcFolder = 'src'; //source folder
let buildFolder = 'build';

let minify = options => {
    return through.obj(async function (chunk, enc, callback) {
        if (chunk.isBuffer()) {
            let code = chunk.contents.toString('utf8');
            let output = await terser.minify(code, options);
            if (output.error) {
                throw output.error;
            }
            chunk.contents = Buffer.from(output.code);
            this.push(chunk);
            return callback();
        }
    });
};



let combineTool = require('../magix-composer/index');
let removeESModuleReg = /"use strict";\s*Object\.defineProperty\(exports,\s*"__esModule",\s*\{\s*value:\s*true\s*\}\);?/g;

let exportsReg = /\bexports\.default\s*=/g;
let removeMiddleDefault = /(_\d+)\.default/g;
let constReg = /\bconst\s+/g;
//清理编译后的代码，减少文件体积
let cleanCode = code => {
    return code.replace(removeESModuleReg, '')
        .replace(exportsReg, 'module.exports=')
        .replace(removeMiddleDefault, '$1')
        .replace(constReg, 'let ');
};
combineTool.config({//打包工具配置
    debug: true,//开发时设置debug为true,方便输出更多的log日志。发布时设置为false
    tmplRadioOrCheckboxRename: false,//禁止工具重写radio的name
    commonFolder: tmplFolder,//开发目录，即原始代码，需要编译转换的文件目录
    compiledFolder: srcFolder,//编译后的目录，即代码编译后，存放在哪个目录里
    projectName: 'kbd',//项目名称，用于样式前缀、内部id规则生成等
    loaderType: 'cmd_es',//加载器类型，或转换成amd iife等
    tmplSupportSlotFn: false,//关闭部分功能以生成更少的编译代码
    tmplSupportSlot: false,//
    uniqueStart: Math.floor(Math.random() * 1200),//随机起始数字，每次编译的代码不同，防止反编译
    compileJSStart(content) {//对代码转换的钩子，这里使用typescript进行代码转换，也可以换成babel等转换器
        let str = ts.transpileModule(content, {
            compilerOptions: {
                lib: ['es7'],
                target: 'es2018',
                module: ts.ModuleKind.None
            }
        });
        str = str.outputText;
        str = cleanCode(str);
        return str;
    },
    progress({ completed, file, total }) {//编译进度条，这里在命令行输出当前编译到的文件和相关进度
        console.log(file, completed + '/' + total);
    },
    resolveRequire(reqInfo) {
        if (reqInfo.mId == 'magix') {
            reqInfo.mId = 'magix5';
        }
    }
});
//清除src目录
gulp.task('cleanSrc', () => del(srcFolder));

/*
    对tmpl目录编译一次到src目录，主要是方便排查生成的可运行代码是否有问题
*/
gulp.task('combine', gulp.series('cleanSrc', () => {
    return combineTool.combine().then(() => {
        console.log('complete');
    }).catch(function (ex) {
        console.log('gulpfile:', ex);
        process.exit();
    });
}));
/**
 * 启动监听任务，实时编译tmpl目录到src目录，开发时使用
 */
gulp.task('watch', gulp.series('combine', () => {
    watch(tmplFolder + '/**/*', e => {
        if (fs.existsSync(e.path)) {
            let c = combineTool.processFile(e.path);
            c.catch(function (ex) {
                console.log('ex', ex);
            });
        } else {
            combineTool.removeFile(e.path);
        }
    });
}));


//压缩选项
let terserOptions = {
    compress: {
        drop_console: true,
        drop_debugger: true,
        keep_fargs: false,
        ecma: 2020,
        global_defs: {
            DEBUG: false
        }
    },
    output: {
        ascii_only: true,
        comments: /^!/
    }
};
/**
 * 删除build目录
 */
gulp.task('cleanBuild', () => {
    return del(buildFolder);
});
/**
 * 把src目录中的文件，移除相应的调试信息并压缩后放到build目录下
 * build目录下的文件与src目录下的一一对应，并未合并，供有动态加载的需求使用。
 */
gulp.task('build', gulp.series('cleanBuild', 'cleanSrc', () => {
    combineTool.config({
        debug: false
    });
    return combineTool.combine().then(() => {
        gulp.src(srcFolder + '/**/*.js')
            .pipe(minify(terserOptions))
            .pipe(gulp.dest(buildFolder));
    }).catch(ex => {
        console.error(ex);
    });
}));

/**
 * 对src下的目录压缩合并到dist目录，对于不需要动态加载的需求，这样的方式便于交付代码。
 * github及gitee上就使用了该方式
 */
gulp.task('dist', gulp.series('cleanSrc', () => {
    combineTool.config({
        debug: false
    });
    return del('./dist').then(() => {
        return combineTool.combine();
    }).then(() => {
        return gulp.src([
            './src/index.js',
            './src/views/**'])
            .pipe(concat('index.js'))
            .pipe(minify(terserOptions))
            .pipe(gulp.dest('./dist'));
    })
}));
