# Synthesises a long "educator" monologue with the Windows speech engine and records the
# engine's own word start times as a reference transcript for spike B.
#   powershell -ExecutionPolicy Bypass -File spikes/fixtures/make-speech.ps1 [-Minutes 10]
# Writes .tmp/fixtures/speech.wav (16 kHz mono) and .tmp/fixtures/speech.words.json.
param(
  [double]$Minutes = 10,
  [int]$Rate = 0
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech

$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$outDir = Join-Path $root '.tmp\fixtures'
New-Item -ItemType Directory -Force $outDir | Out-Null
$wav = Join-Path $outDir 'speech.wav'
$json = Join-Path $outDir 'speech.words.json'

$sentences = @(
  'So today I want to show you the three biggest mistakes people make when they start learning to code.',
  'Mistake number one is trying to learn five languages at the same time.',
  'Pick one language, build something small with it, and finish it.',
  'Number two is watching tutorials for weeks without writing a single line yourself.',
  'You learn by typing, breaking things, and fixing them again.',
  'And the third mistake is never reading the error message.',
  'The error usually tells you exactly which line is wrong and why.',
  'Here is a quick exercise you can do tonight in about twenty minutes.',
  'Open your editor, create a new file, and print the numbers from one to one hundred.',
  'Then change it so every multiple of three prints fizz instead.',
  'If that feels easy, add a rule for multiples of five as well.',
  'Most beginners quit in the first month, and it is almost never because they are not smart enough.',
  'It is because nobody showed them what to practise next.',
  'So save this video, and tomorrow we will build a tiny weather app together.',
  'Comment the language you are learning and I will make the next lesson about it.'
)

# ~150 spoken words per minute at the default rate.
$targetWords = [int]($Minutes * 150)
$script = New-Object System.Collections.Generic.List[string]
$count = 0
$i = 0
while ($count -lt $targetWords) {
  $s = $sentences[$i % $sentences.Count]
  $script.Add($s)
  $count += ($s -split '\s+').Count
  $i++
}
$text = $script -join ' '

$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.Rate = $Rate
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$synth.SetOutputToWaveFile($wav, $format)

$words = New-Object System.Collections.Generic.List[object]
$synth.add_SpeakProgress({
    param($sender, $e)
    $words.Add([pscustomobject]@{ text = $e.Text; start = [math]::Round($e.AudioPosition.TotalSeconds, 3) })
  })
$synth.Speak($text)
$synth.SetOutputToNull()
$synth.Dispose()

# The engine reports start times only; a word ends where the next one starts (capped at 1 s).
$audioSeconds = ((Get-Item $wav).Length - 44) / 32000
$out = for ($k = 0; $k -lt $words.Count; $k++) {
  $w = $words[$k]
  $next = if ($k + 1 -lt $words.Count) { $words[$k + 1].start } else { $audioSeconds }
  [pscustomobject]@{ text = $w.text; start = $w.start; end = [math]::Round([math]::Min($next, $w.start + 1), 3) }
}
$payload = [pscustomobject]@{
  source  = 'System.Speech SpeakProgress (engine word start times)'
  voice   = (New-Object System.Speech.Synthesis.SpeechSynthesizer).Voice.Name
  seconds = [math]::Round($audioSeconds, 2)
  words   = $out
}
$payload | ConvertTo-Json -Depth 4 | Set-Content -Encoding utf8 $json
Write-Host ("Wrote {0} ({1:N1} s) and {2} ({3} words)" -f $wav, $audioSeconds, $json, $words.Count)
