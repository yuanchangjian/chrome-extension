const { DefinePlugin } = require('webpack');
const { merge } = require('webpack-merge');
const common = require('./webpack.common.js');

module.exports = merge(common, {
    devtool: 'inline-source-map',
    mode: 'development',
    plugins: [
        new DefinePlugin({
            _$RPC_URL_: JSON.stringify('ws://127.0.0.1:12346')
        })
    ]
});