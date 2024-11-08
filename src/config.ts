import * as yaml from 'js-yaml'
import {readFileSync, writeFileSync} from 'fs'
import {ConfigType} from './types.js'

export function readConfig(path: string = 'config.yml'): ConfigType {
  const config = yaml.load(readFileSync(path, 'utf8'))
  return config as ConfigType
}

// TODO: write to config.compiled.yml, for preserve config.yml comments
export function writeConfig(path: string = 'config.yml', config: ConfigType): ConfigType {
  try {
    const yamlRaw = yaml.dump(config, {
      lineWidth: -1,
      noCompatMode: true,
      quotingType: '"',
    })
    console.log('yamlRaw:', yamlRaw)
    writeFileSync(path, yamlRaw);
  } catch (e) {
    console.error('Error in writeConfig(): ', e)
  }
  // const config = yaml.load(readFileSync(path, 'utf8'))
  return config
}
