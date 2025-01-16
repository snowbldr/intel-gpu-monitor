import { program } from 'commander'
import { spawnSync, spawn } from 'child_process'

//use commander to setup a new application called intel-gpu-monitor
// the default action is to start the monitor
// to start the monitor
//make sure docker,xpu-smi are installed
//
//start xpu-smi, dumping logs every second to std out using this command:
//xpu-smi dump -d "-1" -m 0,1,2,3,4,5,6,7,17,18,19,20,28
//ignore lines starting with letters in output

program.name('intel-gpu-monitor').
  description('Monitor Intel GPU usage').
  version('1.0.0')

program.action(() => {
  // Check for required tools
  const hasDocker = spawnSync('docker', ['--version']).status === 0
  const hasXpuSmi = spawnSync('xpu-smi', ['--version']).status === 0

  if (!hasDocker) {
    console.error('Error: Docker is not installed. Please install Docker.')
    return
  }
  if (!hasXpuSmi) {
    console.error('Error: xpu-smi is not installed. Please install xpu-smi.')
    return
  }

  // Start xpu-smi and process output
  const xpuSmiProcess = spawn('xpu-smi',
    ['dump', '-d', '-1', '-m', '0,1,2,3,4,5,6,7,17,18,19,20,28'])

  xpuSmiProcess.stdout.on('data', (data) => {
    for (const line of data.toString().split('\n')){
      console.log(line)
    }
    lines.forEach((line) => {
      if (/^[a-zA-Z]/.test(line)) {
        return
      }
      console.log(line)
    })
  })
  xpuSmiProcess.on('close', (code) => {
    console.log(`xpu-smi exited with code ${code}`)
  })
})

program.parse()