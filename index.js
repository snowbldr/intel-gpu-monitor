import {program} from 'commander'
import {spawn, exec} from 'child_process'
import commandExists from 'command-exists'
import {Sender} from "@questdb/nodejs-client";

const sender = Sender.fromConfig(`http::addr=${process.env.DB_HOST || 'localhost:13513'};username=${process.env.DB_USER || 'admin'};password=${process.env.DB_PASS || 'quest'}`)

const requiredTools = {
    'docker': {
        helpUrl: 'https://docs.docker.com/get-started/get-docker/'
    },
    'xpu-smi': {
        helpUrl: 'https://github.com/intel/xpumanager/blob/master/doc/Install_guide.md'
    }
}

const defaultMetrics = '0,1,2,3,4,5,6,7,17,18,19,20,28'

// Check for required tools
for (const [tool, {helpUrl}] of Object.entries(requiredTools)) {
    if (!commandExists.sync(tool)) {
        throw new Error(`${tool} is not installed. See: ${helpUrl}`)
    }
}

async function run(cmd, options = {}) {
    return new Promise((resolve, reject) => exec(cmd, options, (err, stdout, stderr) => {
        if (err) {
            reject(err + "\n" + stderr)
        } else {
            resolve(stdout)
        }
    }))
}

function normalizeFieldName(field) {
    return field.replaceAll(' ', '_')
        .replaceAll('(%)', 'pct')
        .replaceAll('(Celsius Degree)', 'celsius')
        .replaceAll(/[^a-zA-Z_]/g, '')
        .toLowerCase()
}

const utilization = {}

async function getCards() {
    return (await run('intel_gpu_top -L'))
        .split("\n")
        .filter(l => l.includes('card='))
        .map(l => l.split("card=")[1].trim())
}

async function collectUtilization() {
    const cards = await getCards()
    for (const card of cards) {
        streamUtilization(card).catch(e => {
            console.error("utilization steam died", e)
            process.exit()
        })
    }
}

function mapUtilization(intelGpuTopData) {
    return {
        "render_3d_engine_utilization_pct": intelGpuTopData.engines?.["Render/3D"]?.busy,
        "blitter_engine_utilization_pct": intelGpuTopData.engines?.["Blitter"]?.busy,
        "compute_engine_utilization_pct": intelGpuTopData.engines?.["Compute"]?.busy,
        "video_engine_utilization_pct": intelGpuTopData.engines?.["Video"]?.busy,
        "video_enhance_engine_utilization_pct": intelGpuTopData.engines?.["VideoEnhance"]?.busy,
    }
}

async function streamUtilization(card) {
    const intelGpuTopProcess = spawn('intel_gpu_top', ['-J', '-d', `pci:card=${card}`])
    intelGpuTopProcess.stdout.on('data', async (data) => {
        let json = data.toString().trim();
        // the command outputs array brackets when it starts and stops
        if(json.startsWith('[')){
            json = json.substring(1).trim()
        }
        if(json.endsWith(",")){
            json = json.substring(0, json.length - 1)
        }

        if (json.startsWith('{')) {
            utilization[card] = mapUtilization(JSON.parse(json))
        }
    })
    intelGpuTopProcess.stderr.on('data', d => console.error(d.toString()))
    intelGpuTopProcess.on('close', (code) => {
        console.error(`intel_gpu_top for card ${card} exited with code ${code}, aborting.`)
        process.exit(1)
    })
}

async function streamGpuData(metrics) {
    // Start xpu-smi and process output
    const xpuSmiProcess = spawn('xpu-smi',
        ['dump', '--date', '-d', '-1', '-m', metrics])
    let fields = null
    xpuSmiProcess.stdout.on('data', async (data) => {
        for (const line of data.toString().split('\n')) {
            if (!line) {
                continue
            }

            //header always starts with the Timestamp
            if (line.startsWith("Timestamp")) {
                fields = line.split(',').map(f => f.trim()).map(normalizeFieldName)
            } else if (line.match(/^[0-9]{4}-/)) {
                //data line
                const values = line.split(',').map(f => f.trim())
                const message = sender.table('gpu_metrics')
                //skip the timestamp field
                for (let i = 1; i < fields.length; i++) {
                    const value = values[i]
                    const field = fields[i]
                    if (value === 'N/A') {
                        continue
                    }
                    if (value.match(/^[0-9.-]+$/)) {
                        message.floatColumn(field, parseFloat(value))
                    } else {
                        message.timestampColumn(field, value)
                    }
                }
                // add utilization from intel_gpu_top
                const card = values[1]
                for (const [col, val] of Object.entries(utilization[card])){
                    message.floatColumn(col, val)
                }

                await message.at(new Date(values[0]).getTime(), 'ms')
            } else {
                console.log(line)
            }

        }
        await sender.flush()
    })
    xpuSmiProcess.stderr.on('data', d => console.error(d.toString()))
    xpuSmiProcess.on('close', (code) => {
        console.error(`xpu-smi exited with code ${code}, aborting.`)
        process.exit(1)
    })
}

async function startDockerStack() {
    console.log('Starting Services...')
    await run('docker compose up -d --build', {})
    console.log('Services Started!')
}

program.name('intel-gpu-monitor').description('Monitor Intel GPU usage').version('1.0.0')

program.command("list-metrics")
    .description("A wrapper for `xpi-smi dump --help` which prints the list of metrics available")
    .action(async () => {
        console.log(await run('xpu-smi dump --help'))
    })

program.command('stream')
    .description("Start a long running process to stream data from xpu-smi to questdb")
    .option('-m, --metrics <metrics>', 'Comma separate list of metric ids. See `intel-gpu-monitor list-metrics`', defaultMetrics)
    .action(async () => {
        await collectUtilization()
        await streamGpuData(program.opts().metrics || defaultMetrics)
    })

program.parse()