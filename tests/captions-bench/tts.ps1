# Synthesizes a TTS clip with exact per-word timings (SpeakProgress audio positions) for the caption benchmark.
# Usage: tts.ps1 -Out file.wav -Json file.json -Voice "Microsoft David Desktop" -Rate 0 -Text "..."
#   Pauses: put [[pause:2500]] in the text for a 2.5 s silence.
param([string]$Out, [string]$Json, [string]$Voice = 'Microsoft David Desktop', [int]$Rate = 0, [string]$Text)
Add-Type -AssemblyName System.Speech
Add-Type -ReferencedAssemblies System.Speech -TypeDefinition @"
using System; using System.Collections.Generic; using System.Speech.Synthesis; using System.Speech.AudioFormat; using System.Text.RegularExpressions;
public static class FcTts {
  public static List<string> Run(string outFile, string voice, int rate, string text) {
    var words = new List<string>();
    using (var s = new SpeechSynthesizer()) {
      s.SelectVoice(voice); s.Rate = rate;
      s.SetOutputToWaveFile(outFile, new SpeechAudioFormatInfo(16000, AudioBitsPerSample.Sixteen, AudioChannel.Mono));
      s.SpeakProgress += (o, e) => words.Add(e.AudioPosition.TotalSeconds.ToString(System.Globalization.CultureInfo.InvariantCulture) + "\t" + e.Text);
      var pb = new PromptBuilder();
      foreach (var part in Regex.Split(text, @"(\[\[pause:\d+\]\])")) {
        var m = Regex.Match(part, @"^\[\[pause:(\d+)\]\]$");
        if (m.Success) pb.AppendBreak(TimeSpan.FromMilliseconds(int.Parse(m.Groups[1].Value)));
        else if (part.Trim().Length > 0) pb.AppendText(part);
      }
      s.Speak(pb);
    }
    return words;
  }
}
"@
$rows = [FcTts]::Run($Out, $Voice, $Rate, $Text)
$words = @(foreach ($r in $rows) { $p = $r.Split("`t", 2); [ordered]@{ text = $p[1]; start = [double]::Parse($p[0], [Globalization.CultureInfo]::InvariantCulture) } })
$clean = (($Text -replace '\[\[pause:\d+\]\]', ' ') -replace '\s+', ' ').Trim()
[ordered]@{ text = $clean; words = $words; voice = $Voice; rate = $Rate } | ConvertTo-Json -Depth 4 | Set-Content -Path $Json -Encoding utf8
