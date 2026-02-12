
const fs = require('fs');
const path = require('path');
const wcBuilder = require('./zk/witness_calculator');

async function run() {
    const input = {
        "withdrawnValue": "10000000",
        "stateRoot": "27949546726808417680313169660146279625167746387029140142694649845650685293453",
        "associationRoot": "0",
        "label": "396637795973678237978510371521447836762877671019336477284611222663840696077",
        "value": "10000000",
        "nullifier": "18123763422406655337302720503686709581945558280540845207957710559614858565",
        "secret": "95719711342377632406423237891134627254639016375233826292931156388506250828",
        "stateSiblings": [
            "0",
            "21390013637932375216356086309226130861562424636277932179395286045020664403755",
            "35852680108818608054307594222915074176761632702984824095835384350884490323999",
            "39504420786774078275232847873959965111256229748540461723673608831679560333543",
            "39404029000907277292464556408734412130261913210564395069696342233560511006152",
            "24907123534309659921713005795092724527532698077589223246276579583330771465031",
            "22103361713848256938655449390262013863291224679776344310249539314760174194771",
            "28665358770471415124367990738618755861132249577405347373337125991381323369983",
            "6786998243528185650306462855937293964443624194496859265310261299800128548513",
            "50997336463747555660384185705133244552288600683323691317203235239320942865561",
            "13916937046501108967048154641689659101970478684843793251827738918983778486795",
            "18687330317699879820441947090357020131335081966987817560646762002601404312692",
            "5829984778942235508054786484586420582947187778500268001993713384889194068958",
            "50753373693280024567332706650665895696517500665837690627852645244127601005954",
            "1121944223990168834607757664588750855677305893915654403458231958042499198410",
            "36305469446279205776473409399606075705498404819785351200416937243175517105400",
            "35469255857533658984001872129259281494468859278269474829072253610856427637368",
            "25002462511210597541252327993404833104943873248749427570203455562220619092990",
            "10886081007110941254401730551833799559046107841056410372886204429067753525173",
            "42912979393075378276322569383190765808963985610018715455225906661987202405442"
        ],
        "stateIndex": "14",
        "labelIndex": "0",
        "labelSiblings": [
            "0",
            "0"
        ]
    };

    const wasmPath = path.join(__dirname, '../../../packages/circuits/private_transfer/build/main_js/main.wasm');
    if (!fs.existsSync(wasmPath)) {
        console.error('WASM not found at', wasmPath);
        process.exit(1);
    }

    const wasmBuffer = fs.readFileSync(wasmPath);
    console.log('Building witness calculator...');
    const wc = await wcBuilder(wasmBuffer);

    console.log('Calculating WTNS Bin...');
    let wtnsBuff;
    try {
        wtnsBuff = await wc.calculateWTNSBin(input, 0);
        console.log('Success! Buffer length:', wtnsBuff.length);
    } catch (e) {
        console.error('Caught error during calculation:');
        console.error(e);
        process.exit(1);
    }

    const snarkjs = require('snarkjs');
    const zkeyPath = path.join(__dirname, '../../../packages/circuits/private_transfer/output/main_final.zkey');

    if (!fs.existsSync(zkeyPath)) {
        console.error('ZKey not found at', zkeyPath);
        process.exit(1);
    }

    console.log('Generating Proof with snarkjs...');
    try {
        const { proof, publicSignals } = await snarkjs.groth16.prove(zkeyPath, wtnsBuff);
        console.log('Proof generated successfully!');
        console.log('Public Signals:', publicSignals);
    } catch (e) {
        console.error('Caught error during PROVE:');
        console.error(e);
        if (e.message) console.error('Error Message:', e.message);
        process.exit(1);
    }
    process.exit(0);
}

run().catch(e => {
    console.error(e);
    process.exit(1);
});
