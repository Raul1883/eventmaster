import subprocess
import json
import random
import string
import sys
import os

PORT = 3000
SESSION_SECRET=''.join(random.choice(string.ascii_letters + string.digits) for _ in range(15))
STORAGE_URL="https://storage.yandexcloud.net/gyybd-project-storage/static/"


def run_live_output(command, envv=None):
    if envv is None:
        envv = os.environ.copy()
    process = subprocess.Popen(
        command,
        shell=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        env = envv
    )

    while True:
        output = process.stdout.readline()
        if output == '' and process.poll() is not None:
            break
        if output:
            sys.stdout.write(output)
            sys.stdout.flush()
    
    return process.poll()


print("Starting")

print("Init terraform")


subprocess.run(["terraform","init"], capture_output=True, text=True)

print("Storage init")
run_live_output("terraform apply -auto-approve")

result_storage = subprocess.run(["terraform", "output", "-json"], capture_output=True, text=True)

storage_data = json.loads(result_storage.stdout)

print("cloning repository")
run_live_output("git clone https://github.com/Raul1883/eventmaster")


print("building docker")
run_live_output(f"docker buildx build --provenance=false --no-cache -t cr.yandex/{storage_data["registry_id"]["value"]}/gyybv-project-app:latest --push ./eventmaster/")
print("pushing static")
run_live_output('''yc storage s3 cp --recursive ./eventmaster/static/css/ --content-type "text/css" s3://gyybd-project-storage/static/css
yc storage s3 cp --recursive ./eventmaster/static/scripts/ --content-type "application/javascript" s3://gyybd-project-storage/static/scripts
yc storage s3 cp --recursive ./eventmaster/static/images/ --content-type "image/svg+xml" s3://gyybd-project-storage/static/images
''')


print("Config ready, terraform apply compute instances")

env_vars = {
    **os.environ,  
    'TF_VAR_ydb_connection_string': storage_data["connection_string"]["value"],
    'TF_VAR_session_secret': SESSION_SECRET
}

run_live_output("terraform apply -auto-approve",env_vars)


print("Приложение запускается на:")
run_live_output("yc load-balancer network-load-balancer get gyybd-project-network-lb | grep address")
