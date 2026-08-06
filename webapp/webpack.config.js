const path = require('path');

const shared = {
    resolve: {
        extensions: ['.ts', '.tsx', '.js'],
    },
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                exclude: /node_modules/,
                use: {
                    loader: 'ts-loader',
                    options: {transpileOnly: false},
                },
            },
        ],
    },
    performance: {
        // The standalone bundle is a whole editor served once to a phone; the
        // default 244 KiB warning is noise here.
        hints: false,
    },
};

/**
 * The plugin bundle, loaded into the Mattermost webapp.
 *
 * React is provided by the host as a global, so it must not be bundled: two
 * copies of React in one page break hooks.
 */
const pluginBundle = {
    ...shared,
    name: 'plugin',
    entry: './src/index.tsx',
    externals: {
        react: 'React',
        'react-dom': 'ReactDOM',
        redux: 'Redux',
        'react-redux': 'ReactRedux',
    },
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: 'main.js',
    },
};

/**
 * The standalone editor page for mobile, which has no host to borrow anything
 * from and so bundles everything it needs. It shares the editor sources with the
 * plugin bundle but pulls in no framework at all.
 */
const standaloneBundle = {
    ...shared,
    name: 'standalone',
    entry: './src/standalone.ts',
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: 'standalone.js',
    },
};

module.exports = [pluginBundle, standaloneBundle];
