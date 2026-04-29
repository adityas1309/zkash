const mongoose = require('mongoose');

// URI from .env
const uri =
  'mongodb+srv://itaec10800223013_db_user:SIpwyaScGk4WTDgS@cluster0.ctlpirb.mongodb.net/?appName=Cluster0';

async function fixIndex() {
  console.log('Connecting to MongoDB...');
  try {
    await mongoose.connect(uri);
    console.log('Connected.');

    const db = mongoose.connection.db;
    const collection = db.collection('users');

    // List indexes
    const indexes = await collection.indexes();
    console.log(
      'Current Indexes:',
      indexes.map((i) => i.name),
    );

    // Find the bad index: identityCommitment_1 without sparse: true
    const badIndex = indexes.find((i) => i.name === 'identityCommitment_1' && !i.sparse);

    if (badIndex) {
      console.log('Found non-sparse unique index on identityCommitment. Dropping it...');
      try {
        await collection.dropIndex('identityCommitment_1');
        console.log('Index dropped successfully.');
      } catch (err) {
        console.error('Failed to drop index:', err.message);
      }
    } else {
      console.log(
        'No problematic index found. It might have been fixed or sparse property is already present.',
      );
    }
  } catch (error) {
    console.error('Script error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected.');
  }
}

fixIndex();
