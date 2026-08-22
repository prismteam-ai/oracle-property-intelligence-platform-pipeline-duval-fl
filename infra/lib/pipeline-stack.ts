import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';

export class PipelineStack extends cdk.Stack {
  public readonly instance: ec2.Instance;
  public readonly securityGroup: ec2.SecurityGroup;
  public readonly vpc: ec2.IVpc;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Use default VPC for simplicity
    this.vpc = ec2.Vpc.fromLookup(this, 'DefaultVpc', { isDefault: true });

    // Security group: HTTPS (443) + SSH (22)
    this.securityGroup = new ec2.SecurityGroup(this, 'PipelineSG', {
      vpc: this.vpc,
      description: 'Oracle Pipeline EC2 - HTTPS and SSH access',
      allowAllOutbound: true,
    });

    this.securityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      'Allow HTTPS from anywhere',
    );

    this.securityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(22),
      'Allow SSH from anywhere',
    );

    // Allow HTTP for Caddy ACME challenge
    this.securityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      'Allow HTTP for ACME challenge',
    );

    // IAM role for EC2 instance
    const role = new iam.Role(this, 'PipelineRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy'),
      ],
      description: 'IAM role for Oracle Pipeline EC2 instance',
    });

    // Allow access to Secrets Manager for env vars
    role.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['secretsmanager:GetSecretValue'],
        resources: ['*'],
      }),
    );

    // User data script — installs Docker, Docker Compose, Caddy, and starts services
    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      '#!/bin/bash',
      'set -euxo pipefail',
      '',
      '# Update system',
      'yum update -y',
      '',
      '# Install Docker',
      'yum install -y docker',
      'systemctl enable docker',
      'systemctl start docker',
      'usermod -aG docker ec2-user',
      '',
      '# Install Docker Compose v2',
      'DOCKER_CONFIG=/usr/local/lib/docker/cli-plugins',
      'mkdir -p $DOCKER_CONFIG',
      'curl -SL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64" -o $DOCKER_CONFIG/docker-compose',
      'chmod +x $DOCKER_CONFIG/docker-compose',
      'ln -sf $DOCKER_CONFIG/docker-compose /usr/local/bin/docker-compose',
      '',
      '# Install Node.js 22',
      'curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -',
      'yum install -y nodejs',
      '',
      '# Install Caddy via direct binary download (Copr lacks AL2023 support)',
      'curl -sL "https://caddyserver.com/api/download?os=linux&arch=amd64" -o /usr/local/bin/caddy',
      'chmod +x /usr/local/bin/caddy',
      'caddy version',
      '',
      '# Create caddy system user and directories',
      'useradd --system --home /var/lib/caddy --shell /usr/sbin/nologin caddy || true',
      'mkdir -p /etc/caddy /var/lib/caddy /var/log/caddy',
      'chown -R caddy:caddy /var/lib/caddy /var/log/caddy',
      '',
      '# Create data directories',
      'mkdir -p /data/postgres /data/restate /data/pipeline',
      'chown -R 1000:1000 /data',
      '',
      '# Create Caddy config — HTTP on :80, HTTPS on :443 with self-signed cert',
      'cat > /etc/caddy/Caddyfile << \'CADDYEOF\'',
      '{',
      '    email admin@oracle-pipeline.local',
      '    auto_https disable_redirects',
      '}',
      '',
      ':80 {',
      '    handle /api/* {',
      '        reverse_proxy localhost:9080',
      '    }',
      '    handle /restate/* {',
      '        reverse_proxy localhost:9070',
      '    }',
      '    handle /mcp {',
      '        reverse_proxy localhost:9090',
      '    }',
      '    handle {',
      '        respond "Oracle Pipeline - Duval County" 200',
      '    }',
      '}',
      '',
      ':443 {',
      '    tls internal',
      '    handle /api/* {',
      '        reverse_proxy localhost:9080',
      '    }',
      '    handle /restate/* {',
      '        reverse_proxy localhost:9070',
      '    }',
      '    handle /mcp {',
      '        reverse_proxy localhost:9090',
      '    }',
      '    handle {',
      '        respond "Oracle Pipeline - Duval County" 200',
      '    }',
      '}',
      'CADDYEOF',
      '',
      '# Create systemd service for Caddy',
      'cat > /etc/systemd/system/caddy.service << \'SVCEOF\'',
      '[Unit]',
      'Description=Caddy web server',
      'After=network-online.target',
      'Wants=network-online.target',
      '',
      '[Service]',
      'Type=notify',
      'User=caddy',
      'Group=caddy',
      'ExecStart=/usr/local/bin/caddy run --config /etc/caddy/Caddyfile --adapter caddyfile',
      'ExecReload=/usr/local/bin/caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile',
      'TimeoutStopSec=5s',
      'LimitNOFILE=1048576',
      'LimitNPROC=512',
      'AmbientCapabilities=CAP_NET_BIND_SERVICE',
      '',
      '[Install]',
      'WantedBy=multi-user.target',
      'SVCEOF',
      '',
      '# Enable and start Caddy',
      'systemctl daemon-reload',
      'systemctl enable caddy',
      'systemctl start caddy',
      '',
      '# Clone and start pipeline services (non-fatal if no compose file yet)',
      'cd /opt',
      'git clone https://github.com/soofi-xyz/oracle-property-intelligence-platform-pipeline-duval-fl.git app || true',
      'cd /opt/app',
      'docker compose up -d || true',
    );

    // EC2 instance — t3.large, Amazon Linux 2023
    this.instance = new ec2.Instance(this, 'PipelineInstance', {
      vpc: this.vpc,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.LARGE),
      machineImage: ec2.MachineImage.latestAmazonLinux2023(),
      securityGroup: this.securityGroup,
      role,
      userData,
      blockDevices: [
        {
          deviceName: '/dev/xvda',
          volume: ec2.BlockDeviceVolume.ebs(100, {
            volumeType: ec2.EbsDeviceVolumeType.GP3,
            encrypted: true,
            deleteOnTermination: false,
          }),
        },
      ],
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },
      // SSH via SSM Session Manager (AmazonSSMManagedInstanceCore policy attached above)
    });

    // Outputs
    new cdk.CfnOutput(this, 'InstanceId', {
      value: this.instance.instanceId,
      description: 'EC2 Instance ID',
    });

    new cdk.CfnOutput(this, 'PublicIP', {
      value: this.instance.instancePublicIp,
      description: 'EC2 Public IP',
    });

    new cdk.CfnOutput(this, 'PublicDNS', {
      value: this.instance.instancePublicDnsName,
      description: 'EC2 Public DNS',
      exportName: 'PipelineStack-PublicDNS',
    });
  }
}
