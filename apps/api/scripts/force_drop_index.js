const mongoose = require('mongoose');

// URI from .env
const uri = "mongodb+srv://itaec10800223013_db_user:SIpwyaScGk4WTDgS@cluster0.ctlpirb.mongodb.net/?appName=Cluster0";

async function forceDropIndex() {
    console.log('Connecting to MongoDB...');
    try {
        await mongoose.connect(uri);
        console.log('Connected.');

        const db = mongoose.connection.db;
        const collection = db.collection('users');

        const indexName = 'identityCommitment_1';

        console.log(`Attempting to drop index: ${indexName}...`);
        try {
            await collection.dropIndex(indexName);
            console.log('Index dropped successfully. Mongoose will recreate it correctly on next app start.');
        } catch (err) {
            if (err.code === 27) { // Index not found
                console.log('Index not found. Nothing to drop.');
            } else {
                console.error('Failed to drop index:', err.message);
            }
        }

    } catch (error) {
        console.error('Script error:', error);
    } finally {
        await mongoose.disconnect();
        console.log('Disconnected.');
    }
}

forceDropIndex();
