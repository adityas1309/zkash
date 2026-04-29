const mongoose = require('mongoose');

// URI from .env
const uri =
  'mongodb+srv://itaec10800223013_db_user:SIpwyaScGk4WTDgS@cluster0.ctlpirb.mongodb.net/?appName=Cluster0';

async function fixNulls() {
  console.log('Connecting to MongoDB...');
  try {
    await mongoose.connect(uri);
    console.log('Connected.');

    const db = mongoose.connection.db;
    const collection = db.collection('users');

    // 1. Check for documents with explicit null identityCommitment
    const nullDocs = await collection.countDocuments({ identityCommitment: null });
    console.log(`Found ${nullDocs} documents with identityCommitment: null`);

    if (nullDocs > 0) {
      console.log('Unsetting identityCommitment for these documents...');
      const result = await collection.updateMany(
        { identityCommitment: null },
        { $unset: { identityCommitment: '' } },
      );
      console.log(`Updated ${result.modifiedCount} documents.`);
    }

    // 2. Force drop the index to ensure it's recreated with sparse: true if it wasn't
    console.log('Dropping index identityCommitment_1 to ensure clean state...');
    try {
      await collection.dropIndex('identityCommitment_1');
      console.log('Index dropped.');
    } catch (e) {
      console.log("Index drop failed (maybe didn't exist):", e.message);
    }
  } catch (error) {
    console.error('Script error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected.');
  }
}

fixNulls();
