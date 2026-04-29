const mongoose = require('mongoose');

// URI from .env
const uri =
  'mongodb+srv://itaec10800223013_db_user:SIpwyaScGk4WTDgS@cluster0.ctlpirb.mongodb.net/?appName=Cluster0';

async function forceReset() {
  console.log('Connecting to MongoDB...');
  try {
    await mongoose.connect(uri);
    console.log('Connected.');

    // Drop the entire users collection
    console.log('Dropping users collection...');
    try {
      await mongoose.connection.db.dropCollection('users');
      console.log('Users collection dropped.');
    } catch (e) {
      console.log('Error dropping users (might not exist):', e.message);
    }
  } catch (error) {
    console.error('Script error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected.');
  }
}

forceReset();
