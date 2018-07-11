@ECHO OFF
SET PATH=C:\Users\Renaud\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin;%PATH%;
gcloud beta functions deploy untappd --trigger-http