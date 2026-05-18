module.exports = {
    presets: [
        ['@babel/preset-env', { targets: { node: 'current' } }],
        ['@babel/preset-react', { runtime: 'automatic' }],
        '@babel/preset-typescript',
    ],
    plugins: [
        function replaceImportMetaEnv() {
        return {
            visitor: {
            MemberExpression(path) {
                const node = path.node

                if (
                node.object?.type === 'MetaProperty' &&
                node.object.meta.name === 'import' &&
                node.object.property.name === 'meta' &&
                node.property?.name === 'env'
                ) {
                path.replaceWithSourceString('process.env')
                }
            },
            },
        }
        },
    ],
}